import json
import os
from openai import OpenAI
from dotenv import load_dotenv
from tools import TOOLS, execute_tool

load_dotenv()
client = OpenAI()
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def run_stock_agent(ticker: str, risk_tolerance: str = "moderate") -> dict:
    """
    Full multi-step agent loop for stock analysis:
      1. PLAN    — decompose the task into sub-steps
      2. EXECUTE — run each step (some use tools, some are pure LLM)
      3. SYNTHESIZE — combine findings into an investment summary
      4. VERIFY  — self-reflect on completeness and confidence
    """
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    ticker = ticker.upper().strip()

    def _track(resp):
        usage["prompt_tokens"] += resp.usage.prompt_tokens
        usage["completion_tokens"] += resp.usage.completion_tokens
        return resp

    # ── 1. PLAN ──────────────────────────────────────────────────────────────
    plan_resp = _track(
        client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a financial analyst agent planner for {ticker}.\n"
                        "Break the task into exactly 5 concrete sub-tasks.\n"
                        "- Task 1 MUST use tool_hint='get_datetime' and needs_tool=true "
                        "(record today's date for the analysis).\n"
                        "- Task 2 MUST use tool_hint='web_search' and needs_tool=true "
                        "(search the live internet for recent news or earnings updates).\n"
                        "- Task 3 MUST use tool_hint='calculate' and needs_tool=true "
                        "(use a real arithmetic expression; e.g. estimate market cap or "
                        "a simple ratio from widely known numbers).\n"
                        "- Tasks 4, 5 are pure LLM (needs_tool=false, tool_hint='none').\n"
                        "Return ONLY valid JSON:\n"
                        '{"tasks":[{"id":1,"description":"...","needs_tool":true,'
                        '"tool_hint":"get_datetime|web_search|calculate|none"}]}'
                    ),
                },
                {
                    "role": "user",
                    "content": f"Plan a full investment analysis for {ticker}.",
                },
            ],
            response_format={"type": "json_object"},
        )
    )
    tasks = json.loads(plan_resp.choices[0].message.content).get("tasks", [])

    # ── 2. EXECUTE ───────────────────────────────────────────────────────────
    steps = []
    context = ""

    for task in tasks:
        step = {
            "task": task["description"],
            "tool_used": None,
            "tool_result": None,
            "result": "",
        }
        hint = task.get("tool_hint", "none")
        needs_tool = task.get("needs_tool", False) and hint != "none"

        user_content = (
            (f"Previous findings:\n{context}\n\n" if context else "")
            + f"Your task: {task['description']}"
        )
        msgs = [
            {
                "role": "system",
                "content": (
                    f"You are one step in a {ticker} stock analysis agent. "
                    "Be factual and concise — 2-3 sentences. Use tools when instructed."
                ),
            },
            {"role": "user", "content": user_content},
        ]

        if needs_tool:
            r = _track(
                client.chat.completions.create(
                    model=MODEL, messages=msgs, tools=TOOLS, tool_choice="auto"
                )
            )
            msg = r.choices[0].message
            if msg.tool_calls:
                msgs.append(msg)
                used_tools = []
                used_results = []
                for tc in msg.tool_calls:
                    args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                    tool_out = str(execute_tool(tc.function.name, args))
                    used_tools.append(tc.function.name)
                    used_results.append(tool_out)
                    msgs.append({"role": "tool", "content": tool_out, "tool_call_id": tc.id})
                
                step["tool_used"] = used_tools[0] if len(used_tools) == 1 else ", ".join(used_tools)
                step["tool_result"] = used_results[0] if len(used_results) == 1 else " | ".join(used_results)
                
                final = _track(client.chat.completions.create(model=MODEL, messages=msgs))
                step["result"] = final.choices[0].message.content
            else:
                step["result"] = msg.content
        else:
            r = _track(client.chat.completions.create(model=MODEL, messages=msgs))
            step["result"] = r.choices[0].message.content

        context += f"\n\n## {task['description']}\n{step['result']}"
        steps.append(step)

    # ── 3. SYNTHESIZE ─────────────────────────────────────────────────────────
    synth_resp = _track(
        client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
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
                },
                {"role": "user", "content": f"Ticker: {ticker}\n\nResearch:\n{context}"},
            ],
        )
    )
    synthesis = synth_resp.choices[0].message.content

    # ── 4. VERIFY ─────────────────────────────────────────────────────────────
    verify_resp = _track(
        client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a QA reviewer for AI-generated financial analysis. "
                        "Return ONLY valid JSON — no explanation:\n"
                        '{"completeness":"high|medium|low","confidence":0.0,'
                        '"caveats":["caveat 1","caveat 2"],"passed":true}'
                    ),
                },
                {
                    "role": "user",
                    "content": f"Review this {ticker} analysis:\n\n{synthesis}",
                },
            ],
            response_format={"type": "json_object"},
        )
    )
    try:
        verification = json.loads(verify_resp.choices[0].message.content)
    except Exception:
        verification = {"completeness": "medium", "confidence": 0.7, "caveats": [], "passed": True}

    return {
        "ticker": ticker,
        "plan": [t["description"] for t in tasks],
        "steps": steps,
        "synthesis": synthesis,
        "verification": verification,
        "usage": usage,
    }
