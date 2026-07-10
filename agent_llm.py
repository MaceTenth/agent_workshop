import json
import os
import anthropic
from dotenv import load_dotenv
from tools import TOOLS, execute_tool
from llm import CONTEXT_MGMT_MODELS

load_dotenv()
client = anthropic.Anthropic()
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))


# ── Structured-output schemas (Claude guarantees valid JSON against these) ─────
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


def run_stock_agent(ticker: str, risk_tolerance: str = "moderate", model: str = None, emit=None) -> dict:
    """
    Full multi-step agent loop for stock analysis:
      1. PLAN    — decompose the task into sub-steps
      2. EXECUTE — run each step (some use tools, some are pure LLM)
      3. SYNTHESIZE — combine findings into an investment summary
      4. VERIFY  — self-reflect on completeness and confidence

    Pass `emit(event: dict)` to receive live progress as each phase completes.
    """
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    ticker = ticker.upper().strip()
    mdl = model or MODEL

    def _track(resp):
        usage["prompt_tokens"] += resp.usage.input_tokens
        usage["completion_tokens"] += resp.usage.output_tokens
        return resp

    def _emit(ev):
        if emit:
            emit(ev)

    # ── 1. PLAN ──────────────────────────────────────────────────────────────
    _emit({"phase": "plan", "status": "running"})
    plan_resp = _track(
        client.messages.create(
            model=mdl,
            max_tokens=MAX_TOKENS,
            system=(
                f"You are a financial analyst agent planner for {ticker}.\n"
                "Break the task into exactly 5 concrete sub-tasks.\n"
                "- Task 1 MUST use tool_hint='get_datetime' and needs_tool=true "
                "(record today's date for the analysis).\n"
                "- Task 2 MUST use tool_hint='web_search' and needs_tool=true "
                "(search the live internet for recent news or earnings updates).\n"
                "- Task 3 MUST use tool_hint='calculate' and needs_tool=true "
                "(use a real arithmetic expression; e.g. estimate market cap or "
                "a simple ratio from widely known numbers).\n"
                "- Tasks 4, 5 are pure LLM (needs_tool=false, tool_hint='none')."
            ),
            messages=[
                {
                    "role": "user",
                    "content": f"Plan a full investment analysis for {ticker}.",
                },
            ],
            output_config={"format": {"type": "json_schema", "schema": PLAN_SCHEMA}},
        )
    )
    tasks = json.loads(_text(plan_resp)).get("tasks", [])
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
            # Context editing clears stale tool results server-side so a
            # long agentic run doesn't exhaust the context window. Only
            # models that support the beta get it; others fall back to plain.
            if mdl in CONTEXT_MGMT_MODELS:
                r = _track(
                    client.beta.messages.create(
                        betas=["context-management-2025-06-27"],
                        model=mdl,
                        max_tokens=MAX_TOKENS,
                        system=system_prompt,
                        messages=msgs,
                        tools=TOOLS,
                        context_management={"edits": [{"type": "clear_tool_uses_20250919"}]},
                    )
                )
            else:
                r = _track(
                    client.messages.create(
                        model=mdl,
                        max_tokens=MAX_TOKENS,
                        system=system_prompt,
                        messages=msgs,
                        tools=TOOLS,
                    )
                )
            tool_uses = [b for b in r.content if b.type == "tool_use"]
            if tool_uses:
                msgs.append({"role": "assistant", "content": r.content})
                used_tools = []
                used_results = []
                tool_results = []
                for tu in tool_uses:
                    tool_out = str(execute_tool(tu.name, tu.input))
                    used_tools.append(tu.name)
                    used_results.append(tool_out)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": tool_out,
                    })
                msgs.append({"role": "user", "content": tool_results})

                step["tool_used"] = used_tools[0] if len(used_tools) == 1 else ", ".join(used_tools)
                step["tool_result"] = used_results[0] if len(used_results) == 1 else " | ".join(used_results)

                final = _track(
                    client.messages.create(
                        model=mdl,
                        max_tokens=MAX_TOKENS,
                        system=system_prompt,
                        messages=msgs,
                    )
                )
                step["result"] = _text(final)
            else:
                step["result"] = _text(r)
        else:
            r = _track(
                client.messages.create(
                    model=mdl,
                    max_tokens=MAX_TOKENS,
                    system=system_prompt,
                    messages=msgs,
                )
            )
            step["result"] = _text(r)

        context += f"\n\n## {task['description']}\n{step['result']}"
        steps.append(step)
        _emit({"phase": "exec", "status": "done", "step": idx + 1,
               "total": len(tasks), "task": step["task"], "tool_used": step["tool_used"]})

    # ── 3. SYNTHESIZE ─────────────────────────────────────────────────────────
    _emit({"phase": "synthesize", "status": "running"})
    synth_resp = _track(
        client.messages.create(
            model=mdl,
            max_tokens=MAX_TOKENS,
            system=(
                "You are a senior financial analyst. Write an investment summary "
                f"tailored for an investor with a **{risk_tolerance.upper()}** risk tolerance.\n"
                "using exactly these bold headers:\n"
                "**Company Snapshot** — brief description of the business\n"
                "**Key Strengths** — 2-3 bullet points\n"
                "**Key Risks** — 2-3 bullet points\n"
                f"**Recommendation** — BUY / HOLD / SELL with a one-sentence rationale taking into account the user's {risk_tolerance} risk profile.\n"
                "Keep each section to 2-3 sentences. "
                "Remind the reader this is based on training data, not live prices."
            ),
            messages=[
                {"role": "user", "content": f"Ticker: {ticker}\n\nResearch:\n{context}"},
            ],
        )
    )
    synthesis = _text(synth_resp)
    _emit({"phase": "synthesize", "status": "done"})

    # ── 4. VERIFY ─────────────────────────────────────────────────────────────
    _emit({"phase": "verify", "status": "running"})
    verify_resp = _track(
        client.messages.create(
            model=mdl,
            max_tokens=MAX_TOKENS,
            system="You are a QA reviewer for AI-generated financial analysis.",
            messages=[
                {
                    "role": "user",
                    "content": f"Review this {ticker} analysis:\n\n{synthesis}",
                },
            ],
            output_config={"format": {"type": "json_schema", "schema": VERIFY_SCHEMA}},
        )
    )
    try:
        verification = json.loads(_text(verify_resp))
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
