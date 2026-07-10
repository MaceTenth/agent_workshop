import os
from dotenv import load_dotenv
from providers import (
    anthropic_client, openai_client, provider_for_model, require_key,
    to_openai_tools, openai_usage, openai_text, complete as provider_complete,
    DEFAULT_MODEL,
)

load_dotenv()

MODEL = os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL)
MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))

# Models that support the context-management betas (compaction / context
# editing). Anthropic-only — OpenAI calls always fall back to a plain call.
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


def _complete(mdl, system, messages, tools=None, use_context_mgmt=False, cm_beta=None, cm_edit=None):
    """Thin wrapper around providers.complete() using this module's MAX_TOKENS."""
    text, usage, response, provider = provider_complete(
        mdl, system, messages, max_tokens=MAX_TOKENS, tools=tools,
        use_context_mgmt=use_context_mgmt, cm_beta=cm_beta, cm_edit=cm_edit,
    )
    return text, usage, response, provider


def simple_llm_call(user_message: str, model: str = None, trace: dict = None) -> tuple[str, dict]:
    """
    A single, stateless LLM call.
    No conversation history is maintained — each call is fully independent.
    Returns (content, usage).
    """
    mdl = model or MODEL
    messages = [{"role": "user", "content": user_message}]
    _preview(trace, "Stateless", mdl, messages)
    text, usage, _, _ = _complete(mdl, SYSTEM_PROMPT, messages)
    return text, usage


def llm_with_memory(messages: list[dict], model: str = None, trace: dict = None) -> tuple[str, dict]:
    """
    Stateful LLM call.
    The full conversation history is passed on every request so the model
    can reference earlier turns.

    Context management — compaction: once the history approaches the context
    window, Claude summarizes the earlier turns server-side instead of failing
    or silently dropping them, so the conversation can keep going. (Anthropic
    only; OpenAI models fall back to a plain call with the full history.)
    Returns (content, usage).
    """
    mdl = model or MODEL
    _preview(trace, "Memory", mdl, messages)
    text, usage, _, _ = _complete(
        mdl, SYSTEM_PROMPT, messages,
        use_context_mgmt=True, cm_beta="compact-2026-01-12", cm_edit={"type": "compact_20260112"},
    )
    return text, usage


def llm_with_tools(messages: list[dict], model: str = None, trace: dict = None) -> tuple[str, dict, list[dict]]:
    """
    Agentic loop with tool use.
    Calls the model, executes any tool calls, feeds results back, and
    repeats until the model returns a final text response. Works with either
    Anthropic or OpenAI models.

    Context management — context editing: as the loop accumulates tool
    results across turns, older ones are cleared server-side so a long
    agentic run doesn't exhaust the context window (Anthropic only).
    Returns (content, accumulated_usage, list_of_tool_invocations).
    """
    from tools import TOOLS, execute_tool

    mdl = model or MODEL
    provider = provider_for_model(mdl)
    require_key(provider)
    msgs = list(messages)
    _preview(trace, "Tools", mdl, list(messages), tools=[t["name"] for t in TOOLS])
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    invocations = []

    if provider == "anthropic":
        client = anthropic_client()
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
                    model=mdl, max_tokens=MAX_TOKENS, system=SYSTEM_PROMPT, messages=msgs, tools=TOOLS,
                )
            for k, v in _usage(response).items():
                total_usage[k] += v

            if response.stop_reason != "tool_use":
                return _text(response), total_usage, invocations

            msgs.append({"role": "assistant", "content": response.content})
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                result = execute_tool(block.name, block.input)
                invocations.append({"name": block.name, "args": block.input, "result": result})
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": result})
            msgs.append({"role": "user", "content": tool_results})

    # OpenAI path
    client = openai_client()
    oa_tools = to_openai_tools(TOOLS)
    oa_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + list(msgs)
    while True:
        response = client.chat.completions.create(
            model=mdl, max_tokens=MAX_TOKENS, messages=oa_messages, tools=oa_tools,
        )
        for k, v in openai_usage(response).items():
            total_usage[k] += v

        choice = response.choices[0]
        if choice.finish_reason != "tool_calls":
            return openai_text(response), total_usage, invocations

        oa_messages.append(choice.message)
        for tc in choice.message.tool_calls:
            import json
            args = json.loads(tc.function.arguments or "{}")
            result = execute_tool(tc.function.name, args)
            invocations.append({"name": tc.function.name, "args": args, "result": result})
            oa_messages.append({"role": "tool", "tool_call_id": tc.id, "content": str(result)})


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
    text, usage, _, _ = _complete(mdl, SYSTEM_PROMPT, msgs)
    return text, usage, context


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

    # Step 1 — live web search via Claude's built-in web_search server tool.
    # (Always uses Claude for this step regardless of the picker, since
    # web_search is an Anthropic-only server tool not available on OpenAI or
    # on every Claude model, e.g. Haiku.)
    search_context = run_web_search(user_message)

    # Step 2 — synthesis: inject search results back into our regular LLM,
    # using whichever provider/model was picked.
    synthesis_prompt = (
        f"Live web search results:\n\n{search_context}\n\n"
        f"Using the above as context, answer: {user_message}"
    )
    msgs = list(history) + [{"role": "user", "content": synthesis_prompt}]
    _preview(trace, "Web Search", mdl, msgs, tools=["web_search (server-side, step 1)"])
    text, usage, _, _ = _complete(mdl, SYSTEM_PROMPT, msgs)
    return text, usage, search_context


def llm_agent(message: str, history: list[dict], tools_enabled: bool = False,
              web_search_enabled: bool = False, rag_enabled: bool = False,
              model: str = None, trace: dict = None) -> tuple[str, dict, list[dict], str]:
    """
    Combined 'Agent mode': hand the model every enabled capability at once —
    tools (get_datetime / calculate), web_search, and RAG context — in a single
    agentic loop. This is how a real agent composes the building blocks the
    other modules demonstrate in isolation. Works with either Anthropic or
    OpenAI models.
    Returns (text, accumulated_usage, tool_invocations, rag_context).
    """
    from tools import TOOLS as ALL_TOOLS, execute_tool

    mdl = model or MODEL
    provider = provider_for_model(mdl)
    require_key(provider)

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

    if provider == "anthropic":
        client = anthropic_client()
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
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": result})
            msgs.append({"role": "user", "content": tool_results})

    # OpenAI path
    client = openai_client()
    oa_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + list(msgs)
    oa_tools = to_openai_tools(tools) if tools else None
    while True:
        kwargs = dict(model=mdl, max_tokens=MAX_TOKENS, messages=oa_messages)
        if oa_tools:
            kwargs["tools"] = oa_tools
        response = client.chat.completions.create(**kwargs)
        for k, v in openai_usage(response).items():
            total_usage[k] += v

        choice = response.choices[0]
        if choice.finish_reason != "tool_calls":
            return openai_text(response), total_usage, invocations, rag_context

        oa_messages.append(choice.message)
        for tc in choice.message.tool_calls:
            import json
            args = json.loads(tc.function.arguments or "{}")
            result = execute_tool(tc.function.name, args)
            invocations.append({"name": tc.function.name, "args": args, "result": result})
            oa_messages.append({"role": "tool", "tool_call_id": tc.id, "content": str(result)})
