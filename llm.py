import os
import anthropic
from dotenv import load_dotenv

load_dotenv()

# Resolves ANTHROPIC_API_KEY from the environment (loaded from .env above).
client = anthropic.Anthropic()
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))

# Models that support the context-management betas (compaction / context
# editing). A model outside this set (e.g. Haiku) falls back to a plain call.
CONTEXT_MGMT_MODELS = {
    "claude-sonnet-5", "claude-sonnet-4-6",
    "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
}


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


def _preview(trace, mode, model, messages, tools=None):
    """Record the exact request payload for the 'peek under the hood' panel."""
    if trace is not None:
        trace["preview"] = {
            "mode": mode,
            "model": model,
            "system": SYSTEM_PROMPT,
            "messages": messages,
            "tools": tools,
        }


def simple_llm_call(user_message: str, model: str = None, trace: dict = None) -> tuple[str, dict]:
    """
    A single, stateless LLM call.
    No conversation history is maintained — each call is fully independent.
    Returns (content, usage).
    """
    mdl = model or MODEL
    messages = [{"role": "user", "content": user_message}]
    _preview(trace, "Stateless", mdl, messages)
    response = client.messages.create(
        model=mdl,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return _text(response), _usage(response)


def llm_with_memory(messages: list[dict], model: str = None, trace: dict = None) -> tuple[str, dict]:
    """
    Stateful LLM call.
    The full conversation history is passed on every request so the model
    can reference earlier turns.

    Context management — compaction: once the history approaches the context
    window, Claude summarizes the earlier turns server-side instead of failing
    or silently dropping them, so the conversation can keep going.
    Returns (content, usage).
    """
    mdl = model or MODEL
    _preview(trace, "Memory", mdl, messages)
    if mdl in CONTEXT_MGMT_MODELS:
        response = client.beta.messages.create(
            betas=["compact-2026-01-12"],
            model=mdl,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=messages,
            context_management={"edits": [{"type": "compact_20260112"}]},
        )
    else:
        response = client.messages.create(
            model=mdl,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
    return _text(response), _usage(response)


def llm_with_tools(messages: list[dict], model: str = None, trace: dict = None) -> tuple[str, dict, list[dict]]:
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

    mdl = model or MODEL
    msgs = list(messages)
    _preview(trace, "Tools", mdl, list(messages), tools=[t["name"] for t in TOOLS])
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    invocations = []

    # The control loop
    while True:
        if mdl in CONTEXT_MGMT_MODELS:
            response = client.beta.messages.create(
                betas=["context-management-2025-06-27"],
                model=mdl,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=msgs,
                tools=TOOLS,
                context_management={"edits": [{"type": "clear_tool_uses_20250919"}]},
            )
        else:
            response = client.messages.create(
                model=mdl,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=msgs,
                tools=TOOLS,
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


def llm_with_rag(user_message: str, history: list[dict], model: str = None, trace: dict = None) -> tuple[str, dict, str]:
    """
    Simple RAG pipeline (no embeddings):
      1. Retrieve relevant employee records via keyword matching.
      2. Format them as plain-text context.
      3. Inject context + original question into the LLM.
    Returns (final_answer, usage, formatted_context).
    """
    from rag import retrieve, format_docs

    mdl = model or MODEL
    docs = retrieve(user_message)
    context = format_docs(docs)
    augmented = (
        f"{context}\n\n"
        f"Using the above employee data, answer: {user_message}"
    )
    msgs = list(history) + [{"role": "user", "content": augmented}]
    _preview(trace, "RAG", mdl, msgs)
    response = client.messages.create(
        model=mdl,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=msgs,
    )
    return _text(response), _usage(response), context


def llm_with_web_search(user_message: str, history: list[dict], model: str = None, trace: dict = None) -> tuple[str, dict, str]:
    """
    Two-step web-search pipeline:
      1. Call Claude's built-in web_search server tool to get a fresh,
         web-grounded answer for the query.
      2. Feed (search context + original message + optional history) into
         our regular LLM to produce the final response.
    Returns (final_answer, usage, search_context).
    """
    from web_search import run_web_search

    mdl = model or MODEL

    # Step 1 — live web search via Claude's server-side web_search tool.
    # (Uses its own web-search-capable model regardless of the picker, since
    # the web_search tool isn't available on every model, e.g. Haiku.)
    search_context = run_web_search(user_message)

    # Step 2 — synthesis: inject search results back into our regular LLM
    synthesis_prompt = (
        f"Live web search results:\n\n{search_context}\n\n"
        f"Using the above as context, answer: {user_message}"
    )
    msgs = list(history) + [{"role": "user", "content": synthesis_prompt}]
    _preview(trace, "Web Search", mdl, msgs, tools=["web_search (server-side, step 1)"])
    response = client.messages.create(
        model=mdl,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=msgs,
    )
    return _text(response), _usage(response), search_context


def llm_agent(message: str, history: list[dict], tools_enabled: bool = False,
              web_search_enabled: bool = False, rag_enabled: bool = False,
              model: str = None, trace: dict = None) -> tuple[str, dict, list[dict], str]:
    """
    Combined 'Agent mode': hand the model every enabled capability at once —
    tools (get_datetime / calculate), web_search, and RAG context — in a single
    agentic loop. This is how a real agent composes the building blocks the
    other modules demonstrate in isolation.
    Returns (text, accumulated_usage, tool_invocations, rag_context).
    """
    from tools import TOOLS as ALL_TOOLS, execute_tool

    mdl = model or MODEL

    # Expose only the tools whose toggles are on
    wanted = set()
    if tools_enabled:
        wanted |= {"get_datetime", "calculate"}
    if web_search_enabled:
        wanted |= {"web_search"}
    tools = [t for t in ALL_TOOLS if t["name"] in wanted]

    # RAG: retrieve and inject the records into the user turn
    rag_context = ""
    user_content = message
    if rag_enabled:
        from rag import retrieve, format_docs
        docs = retrieve(message)
        rag_context = format_docs(docs)
        user_content = (
            f"{rag_context}\n\n"
            f"Using the above employee data as context when relevant, answer: {message}"
        )

    msgs = list(history) + [{"role": "user", "content": user_content}]
    _preview(trace, "Agent", mdl, list(msgs), tools=[t["name"] for t in tools] or None)

    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    invocations = []
    use_cm = bool(tools) and mdl in CONTEXT_MGMT_MODELS

    while True:
        kwargs = dict(model=mdl, max_tokens=MAX_TOKENS, system=SYSTEM_PROMPT, messages=msgs)
        if tools:
            kwargs["tools"] = tools
        if use_cm:
            response = client.beta.messages.create(
                betas=["context-management-2025-06-27"],
                context_management={"edits": [{"type": "clear_tool_uses_20250919"}]},
                **kwargs,
            )
        else:
            response = client.messages.create(**kwargs)

        for k, v in _usage(response).items():
            total_usage[k] += v

        if response.stop_reason != "tool_use":
            return _text(response), total_usage, invocations, rag_context

        msgs.append({"role": "assistant", "content": response.content})
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
