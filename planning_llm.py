"""
planning_llm.py — LLM functions for the Planning & Prompt Engineering workshop module.

Covers three core concepts:
  1. Prompt Engineering  — same question, different prompting strategies
  2. Task Decomposition  — break a complex task into ordered subtasks
  3. ReAct Loop          — Reason + Act traces (Think → Act → Observe → Answer)

Works with either Anthropic or OpenAI models via providers.complete().
"""

import os
from dotenv import load_dotenv
from providers import complete as provider_complete, DEFAULT_MODEL

load_dotenv()

MODEL = os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL)
MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))


def _complete(mdl, system, messages, effort=None):
    text, usage, _, _ = provider_complete(mdl, system, messages, max_tokens=MAX_TOKENS, effort=effort)
    return text, usage


# ── Prompt Engineering ────────────────────────────────────────────────────────

def zero_shot(question: str, model: str = None, effort: str = None) -> tuple[str, dict]:
    """Direct answer — no examples, no reasoning instructions."""
    return _complete(
        model or MODEL,
        "You are a helpful assistant. Answer directly and concisely.",
        [{"role": "user", "content": question}],
        effort=effort,
    )


def few_shot(question: str, model: str = None, effort: str = None) -> tuple[str, dict]:
    """Provide two worked examples before asking the real question."""
    return _complete(
        model or MODEL,
        "You are a helpful assistant that follows the pattern shown in the examples.",
        [
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
        effort=effort,
    )


def chain_of_thought(question: str, model: str = None, effort: str = None) -> tuple[str, dict]:
    """Instruct the model to reason step-by-step before giving its final answer."""
    return _complete(
        model or MODEL,
        "You are a helpful assistant. Before answering, think step by step. "
        "Show your full reasoning process, then state your final answer clearly.",
        [{"role": "user", "content": question}],
        effort=effort,
    )


# ── Task Decomposition ────────────────────────────────────────────────────────

def decompose_task(task: str, model: str = None, effort: str = None) -> tuple[str, dict, list[str]]:
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
    content, usage = _complete(
        model or MODEL, system,
        [{"role": "user", "content": f"Decompose this task into subtasks: {task}"}],
        effort=effort,
    )

    steps: list[str] = []
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped and stripped[0].isdigit() and ". " in stripped:
            steps.append(stripped.split(". ", 1)[1])

    return content, usage, steps


# ── ReAct Loop ────────────────────────────────────────────────────────────────

def react_loop(task: str, model: str = None, effort: str = None) -> tuple[list[dict], dict]:
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
    content, usage = _complete(model or MODEL, system, [{"role": "user", "content": task}], effort=effort)

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

    return steps, usage
