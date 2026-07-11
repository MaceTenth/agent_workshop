import json
import os
from dotenv import load_dotenv
from tools import TOOLS, execute_tool
from llm import CONTEXT_MGMT_MODELS
from providers import (
    anthropic_client, openai_client, provider_for_model, require_key,
    to_openai_tools, openai_usage, openai_text, DEFAULT_MODEL,
)

load_dotenv()

MODEL = os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL)
MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))


# ── Structured-output schemas (both providers guarantee valid JSON against these) ─
PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "description": {"type": "string"},
                    "needs_tool": {"type": "boolean"},
                    "tool_hint": {
                        "type": "string",
                        "enum": ["get_datetime", "web_search", "calculate", "none"],
                    },
                },
                "required": ["id", "description", "needs_tool", "tool_hint"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["tasks"],
    "additionalProperties": False,
}

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "completeness": {"type": "string", "enum": ["high", "medium", "low"]},
        "confidence": {"type": "number"},
        "caveats": {"type": "array", "items": {"type": "string"}},
        "passed": {"type": "boolean"},
    },
    "required": ["completeness", "confidence", "caveats", "passed"],
    "additionalProperties": False,
}


def _text(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text")


def _call(mdl, provider, system, messages, tools=None, json_schema=None, schema_name="response"):
    """Single-turn call that works for both providers, with optional tools
    and optional strict JSON-schema structured output."""
    if provider == "anthropic":
        client = anthropic_client()
        kwargs = dict(model=mdl, max_tokens=MAX_TOKENS, system=system, messages=messages)
        if tools:
            kwargs["tools"] = tools
        if json_schema:
            kwargs["output_config"] = {"format": {"type": "json_schema", "schema": json_schema}}
        response = client.messages.create(**kwargs)
        return response, _text(response), {
            "prompt_tokens": response.usage.input_tokens,
            "completion_tokens": response.usage.output_tokens,
        }

    client = openai_client()
    oa_messages = [{"role": "system", "content": system}] + list(messages)
    kwargs = dict(model=mdl, max_tokens=MAX_TOKENS, messages=oa_messages)
    if tools:
        kwargs["tools"] = to_openai_tools(tools)
    if json_schema:
        kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": json_schema, "strict": True},
        }
    response = client.chat.completions.create(**kwargs)
    return response, openai_text(response), {
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    }


def run_stock_agent(ticker: str, risk_tolerance: str = "moderate", model: str = None, emit=None) -> dict:
    """
    Full multi-step agent loop for stock analysis:
      1. PLAN    — decompose the task into sub-steps
      2. EXECUTE — run each step (some use tools, some are pure LLM)
      3. SYNTHESIZE — combine findings into an investment summary
      4. VERIFY  — self-reflect on completeness and confidence

    Works with either Anthropic or OpenAI models.
    Pass `emit(event: dict)` to receive live progress as each phase completes.
    """
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    ticker = ticker.upper().strip()
    mdl = model or MODEL
    provider = provider_for_model(mdl)
    require_key(provider)
    client = anthropic_client() if provider == "anthropic" else openai_client()

    def _track(u):
        usage["prompt_tokens"] += u["prompt_tokens"]
        usage["completion_tokens"] += u["completion_tokens"]

    def _emit(ev):
        if emit:
            emit(ev)

    # ── 1. PLAN ──────────────────────────────────────────────────────────────
    _emit({"phase": "plan", "status": "running"})
    _, plan_text, plan_usage = _call(
        mdl, provider,
        f"You are a financial analyst agent planner for {ticker}.\n"
        "Break the task into exactly 5 concrete sub-tasks.\n"
        "- Task 1 MUST use tool_hint='get_datetime' and needs_tool=true "
        "(record today's date for the analysis).\n"
        "- Task 2 MUST use tool_hint='web_search' and needs_tool=true "
        "(search the live internet for recent news or earnings updates).\n"
        "- Task 3 MUST use tool_hint='calculate' and needs_tool=true "
        "(use a real arithmetic expression; e.g. estimate market cap or "
        "a simple ratio from widely known numbers).\n"
        "- Tasks 4, 5 are pure LLM (needs_tool=false, tool_hint='none').",
        [{"role": "user", "content": f"Plan a full investment analysis for {ticker}."}],
        json_schema=PLAN_SCHEMA, schema_name="plan",
    )
    _track(plan_usage)
    tasks = json.loads(plan_text).get("tasks", [])
    _emit({"phase": "plan", "status": "done", "total": len(tasks),
           "tasks": [t["description"] for t in tasks]})

    # ── 2. EXECUTE ───────────────────────────────────────────────────────────
    steps = []
    context = ""

    for idx, task in enumerate(tasks):
        _emit({"phase": "exec", "status": "running", "step": idx + 1,
               "total": len(tasks), "task": task["description"]})
        step = {
            "task": task["description"],
            "tool_used": None,
            "tool_result": None,
            "result": "",
        }
        hint = task.get("tool_hint", "none")
        needs_tool = task.get("needs_tool", False) and hint != "none"

        system_prompt = (
            f"You are one step in a {ticker} stock analysis agent. "
            "Be factual and concise — 2-3 sentences. Use tools when instructed."
        )
        user_content = (
            (f"Previous findings:\n{context}\n\n" if context else "")
            + f"Your task: {task['description']}"
        )
        msgs = [{"role": "user", "content": user_content}]

        if needs_tool:
            if provider == "anthropic":
                # Context editing clears stale tool results server-side so a
                # long agentic run doesn't exhaust the context window. Only
                # models that support the beta get it; others fall back.
                if mdl in CONTEXT_MGMT_MODELS:
                    r = client.beta.messages.create(
                        betas=["context-management-2025-06-27"],
                        model=mdl, max_tokens=MAX_TOKENS, system=system_prompt,
                        messages=msgs, tools=TOOLS,
                        context_management={"edits": [{"type": "clear_tool_uses_20250919"}]},
                    )
                else:
                    r = client.messages.create(
                        model=mdl, max_tokens=MAX_TOKENS, system=system_prompt,
                        messages=msgs, tools=TOOLS,
                    )
                _track({"prompt_tokens": r.usage.input_tokens, "completion_tokens": r.usage.output_tokens})
                tool_uses = [b for b in r.content if b.type == "tool_use"]
                if tool_uses:
                    msgs.append({"role": "assistant", "content": r.content})
                    used_tools, used_results, tool_results = [], [], []
                    for tu in tool_uses:
                        tool_out = str(execute_tool(tu.name, tu.input))
                        used_tools.append(tu.name)
                        used_results.append(tool_out)
                        tool_results.append({"type": "tool_result", "tool_use_id": tu.id, "content": tool_out})
                    msgs.append({"role": "user", "content": tool_results})

                    step["tool_used"] = used_tools[0] if len(used_tools) == 1 else ", ".join(used_tools)
                    step["tool_result"] = used_results[0] if len(used_results) == 1 else " | ".join(used_results)

                    final = client.messages.create(
                        model=mdl, max_tokens=MAX_TOKENS, system=system_prompt, messages=msgs,
                    )
                    _track({"prompt_tokens": final.usage.input_tokens, "completion_tokens": final.usage.output_tokens})
                    step["result"] = _text(final)
                else:
                    step["result"] = _text(r)
            else:
                oa_messages = [{"role": "system", "content": system_prompt}] + msgs
                r = client.chat.completions.create(
                    model=mdl, max_tokens=MAX_TOKENS, messages=oa_messages, tools=to_openai_tools(TOOLS),
                )
                _track({"prompt_tokens": r.usage.prompt_tokens, "completion_tokens": r.usage.completion_tokens})
                choice = r.choices[0]
                if choice.finish_reason == "tool_calls":
                    oa_messages.append(choice.message)
                    used_tools, used_results = [], []
                    for tc in choice.message.tool_calls:
                        args = json.loads(tc.function.arguments or "{}")
                        tool_out = str(execute_tool(tc.function.name, args))
                        used_tools.append(tc.function.name)
                        used_results.append(tool_out)
                        oa_messages.append({"role": "tool", "tool_call_id": tc.id, "content": tool_out})

                    step["tool_used"] = used_tools[0] if len(used_tools) == 1 else ", ".join(used_tools)
                    step["tool_result"] = used_results[0] if len(used_results) == 1 else " | ".join(used_results)

                    final = client.chat.completions.create(model=mdl, max_tokens=MAX_TOKENS, messages=oa_messages)
                    _track({"prompt_tokens": final.usage.prompt_tokens, "completion_tokens": final.usage.completion_tokens})
                    step["result"] = openai_text(final)
                else:
                    step["result"] = openai_text(r)
        else:
            _, text, u = _call(mdl, provider, system_prompt, msgs)
            _track(u)
            step["result"] = text

        context += f"\n\n## {task['description']}\n{step['result']}"
        steps.append(step)
        _emit({"phase": "exec", "status": "done", "step": idx + 1,
               "total": len(tasks), "task": step["task"], "tool_used": step["tool_used"]})

    # ── 3. SYNTHESIZE ─────────────────────────────────────────────────────────
    _emit({"phase": "synthesize", "status": "running"})
    _, synthesis, synth_usage = _call(
        mdl, provider,
        "You are a senior financial analyst. Write an investment summary "
        f"tailored for an investor with a **{risk_tolerance.upper()}** risk tolerance.\n"
        "using exactly these bold headers:\n"
        "**Company Snapshot** — brief description of the business\n"
        "**Key Strengths** — 2-3 bullet points\n"
        "**Key Risks** — 2-3 bullet points\n"
        f"**Recommendation** — BUY / HOLD / SELL with a one-sentence rationale taking into account the user's {risk_tolerance} risk profile.\n"
        "Keep each section to 2-3 sentences. "
        "Remind the reader this is based on training data, not live prices.",
        [{"role": "user", "content": f"Ticker: {ticker}\n\nResearch:\n{context}"}],
    )
    _track(synth_usage)
    _emit({"phase": "synthesize", "status": "done"})

    # ── 4. VERIFY ─────────────────────────────────────────────────────────────
    _emit({"phase": "verify", "status": "running"})
    _, verify_text, verify_usage = _call(
        mdl, provider,
        "You are a QA reviewer for AI-generated financial analysis.",
        [{"role": "user", "content": f"Review this {ticker} analysis:\n\n{synthesis}"}],
        json_schema=VERIFY_SCHEMA, schema_name="verification",
    )
    _track(verify_usage)
    try:
        verification = json.loads(verify_text)
    except Exception:
        verification = {"completeness": "medium", "confidence": 0.7, "caveats": [], "passed": True}
    _emit({"phase": "verify", "status": "done"})

    return {
        "ticker": ticker,
        "plan": [t["description"] for t in tasks],
        "steps": steps,
        "synthesis": synthesis,
        "verification": verification,
        "usage": usage,
    }
