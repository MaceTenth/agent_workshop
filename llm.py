import os
import anthropic
from dotenv import load_dotenv

load_dotenv()

# Resolves ANTHROPIC_API_KEY from the environment (loaded from .env above).
client = anthropic.Anthropic()
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))


SYSTEM_PROMPT = "You are a helpful assistant."


def _usage(response) -> dict:
    """
    Normalise Claude usage into the {prompt, completion, total} shape the
    frontend expects. Claude reports input_tokens / output_tokens.
    """
    u = response.usage
    prompt = u.input_tokens
    completion = u.output_tokens
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
    }


def _text(response) -> str:
    """Concatenate the text blocks of a Claude response into a plain string."""
    return "".join(b.text for b in response.content if b.type == "text")


def simple_llm_call(user_message: str) -> tuple[str, dict]:
    """
    A single, stateless LLM call.
    No conversation history is maintained — each call is fully independent.
    Returns (content, usage).
    """
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    return _text(response), _usage(response)


def llm_with_memory(messages: list[dict]) -> tuple[str, dict]:
    """
    Stateful LLM call.
    The full conversation history is passed on every request so the model
    can reference earlier turns.

    Context management — compaction: once the history approaches the context
    window, Claude summarizes the earlier turns server-side instead of failing
    or silently dropping them, so the conversation can keep going.
    Returns (content, usage).
    """
    response = client.beta.messages.create(
        betas=["compact-2026-01-12"],
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=messages,
        context_management={"edits": [{"type": "compact_20260112"}]},
    )
    return _text(response), _usage(response)


def llm_with_tools(messages: list[dict]) -> tuple[str, dict, list[dict]]:
    """
    Agentic loop with Claude tool use.
    Calls the model, executes any tool calls, feeds results back, and
    repeats until the model returns a final text response.

    Context management — context editing: as the loop accumulates tool
    results across turns, older ones are cleared server-side so a long
    agentic run doesn't exhaust the context window.
    Returns (content, accumulated_usage, list_of_tool_invocations).
    """
    from tools import TOOLS, execute_tool

    msgs = list(messages)
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    invocations = []

    # The control loop
    while True:
        response = client.beta.messages.create(
            betas=["context-management-2025-06-27"],
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=msgs,
            tools=TOOLS,
            context_management={"edits": [{"type": "clear_tool_uses_20250919"}]},
        )
        for k, v in _usage(response).items():
            total_usage[k] += v

        if response.stop_reason != "tool_use":
            return _text(response), total_usage, invocations

        # Append the assistant turn that contains the tool-use requests
        msgs.append({"role": "assistant", "content": response.content})

        # Execute every tool the model asked for; return all results together
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            result = execute_tool(block.name, block.input)
            invocations.append({"name": block.name, "args": block.input, "result": result})
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result,
            })
        msgs.append({"role": "user", "content": tool_results})


def llm_with_rag(user_message: str, history: list[dict]) -> tuple[str, dict, str]:
    """
    Simple RAG pipeline (no embeddings):
      1. Retrieve relevant employee records via keyword matching.
      2. Format them as plain-text context.
      3. Inject context + original question into the LLM.
    Returns (final_answer, usage, formatted_context).
    """
    from rag import retrieve, format_docs

    docs = retrieve(user_message)
    context = format_docs(docs)
    augmented = (
        f"{context}\n\n"
        f"Using the above employee data, answer: {user_message}"
    )
    msgs = list(history) + [{"role": "user", "content": augmented}]
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=msgs,
    )
    return _text(response), _usage(response), context


def llm_with_web_search(user_message: str, history: list[dict]) -> tuple[str, dict, str]:
    """
    Two-step web-search pipeline:
      1. Call Claude's built-in web_search server tool to get a fresh,
         web-grounded answer for the query.
      2. Feed (search context + original message + optional history) into
         our regular LLM to produce the final response.
    Returns (final_answer, usage, search_context).
    """
    from web_search import run_web_search

    # Step 1 — live web search via Claude's server-side web_search tool
    search_context = run_web_search(user_message)

    # Step 2 — synthesis: inject search results back into our regular LLM
    synthesis_prompt = (
        f"Live web search results:\n\n{search_context}\n\n"
        f"Using the above as context, answer: {user_message}"
    )
    msgs = list(history) + [{"role": "user", "content": synthesis_prompt}]
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=msgs,
    )
    return _text(response), _usage(response), search_context
