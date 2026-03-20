"""
planning_llm.py — LLM functions for the Planning & Prompt Engineering workshop module.

Covers three core concepts:
  1. Prompt Engineering  — same question, different prompting strategies
  2. Task Decomposition  — break a complex task into ordered subtasks
  3. ReAct Loop          — Reason + Act traces (Think → Act → Observe → Answer)
"""

import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def _usage(response) -> dict:
    u = response.usage
    return {
        "prompt_tokens": u.prompt_tokens,
        "completion_tokens": u.completion_tokens,
        "total_tokens": u.total_tokens,
    }


# ── Prompt Engineering ────────────────────────────────────────────────────────

def zero_shot(question: str) -> tuple[str, dict]:
    """Direct answer — no examples, no reasoning instructions."""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a helpful assistant. Answer directly and concisely."},
            {"role": "user",   "content": question},
        ],
    )
    return response.choices[0].message.content, _usage(response)


def few_shot(question: str) -> tuple[str, dict]:
    """Provide two worked examples before asking the real question."""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a helpful assistant that follows the pattern shown in the examples."},
            {
                "role": "user",
                "content": (
                    "Q: How many letters are in the word 'cat'?\n"
                    "A: Let me count: c-a-t. That is 3 letters.\n\n"
                    "Q: How many letters are in the word 'elephant'?\n"
                    "A: Let me count: e-l-e-p-h-a-n-t. That is 8 letters.\n\n"
                    f"Q: {question}\nA:"
                ),
            },
        ],
    )
    return response.choices[0].message.content, _usage(response)


def chain_of_thought(question: str) -> tuple[str, dict]:
    """Instruct the model to reason step-by-step before giving its final answer."""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a helpful assistant. Before answering, think step by step. "
                    "Show your full reasoning process, then state your final answer clearly."
                ),
            },
            {"role": "user", "content": question},
        ],
    )
    return response.choices[0].message.content, _usage(response)


# ── Task Decomposition ────────────────────────────────────────────────────────

def decompose_task(task: str) -> tuple[str, dict, list[str]]:
    """
    Ask the LLM to break a complex task into ordered subtasks.
    Returns (full_response, usage, list_of_step_strings).
    """
    system = (
        "You are a planning assistant. When given a task, analyze it and produce an ordered plan.\n"
        "Format your output EXACTLY as:\n\n"
        "PLAN:\n"
        "1. [first subtask]\n"
        "2. [second subtask]\n"
        "...\n\n"
        "REASONING:\n"
        "[Explain why you chose this breakdown and what the agent needs to keep in mind]"
    )
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": f"Decompose this task into subtasks: {task}"},
        ],
    )
    content = response.choices[0].message.content

    steps: list[str] = []
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped and stripped[0].isdigit() and ". " in stripped:
            steps.append(stripped.split(". ", 1)[1])

    return content, _usage(response), steps


# ── ReAct Loop ────────────────────────────────────────────────────────────────

def react_loop(task: str) -> tuple[list[dict], dict]:
    """
    Simulate a ReAct (Reason + Act) loop.
    The LLM is prompted to produce interleaved Thought / Action / Observation steps,
    then a Final Answer. The raw text is parsed into structured step dicts.
    Returns (steps, usage).
    """
    system = (
        "You are an agent solving a problem using the ReAct (Reason + Act) framework.\n"
        "For each step output EXACTLY one of these prefixes:\n"
        "  Thought: [your internal reasoning about what to do next]\n"
        "  Action: [the concrete action you would take or information you would look up]\n"
        "  Observation: [what you learn or infer after taking that action]\n\n"
        "After 3–5 steps, output:\n"
        "  Final Answer: [your complete, well-reasoned answer]\n\n"
        "Be educational and concrete — this is a workshop demo showing how agents think."
    )
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": task},
        ],
    )
    content = response.choices[0].message.content

    PREFIXES = [
        ("Thought:",      "think"),
        ("Action:",       "act"),
        ("Observation:",  "observe"),
        ("Final Answer:", "answer"),
    ]

    steps: list[dict] = []
    current: dict | None = None

    for line in content.split("\n"):
        stripped = line.strip()
        matched = False
        for prefix, step_type in PREFIXES:
            if stripped.startswith(prefix):
                if current:
                    steps.append(current)
                current = {"type": step_type, "content": stripped[len(prefix):].strip()}
                matched = True
                break
        if not matched and stripped and current:
            current["content"] += " " + stripped

    if current:
        steps.append(current)

    return steps, _usage(response)
