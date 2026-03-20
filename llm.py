import json
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


SYSTEM_PROMPT = "You are a helpful assistant."


def _usage(response) -> dict:
    u = response.usage
    return {
        "prompt_tokens": u.prompt_tokens,
        "completion_tokens": u.completion_tokens,
        "total_tokens": u.total_tokens,
    }


def simple_llm_call(user_message: str) -> tuple[str, dict]:
    """
    A single, stateless LLM call.
    No conversation history is maintained — each call is fully independent.
    Returns (content, usage).
    """
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    return response.choices[0].message.content, _usage(response)


def llm_with_memory(messages: list[dict]) -> tuple[str, dict]:
    """
    Stateful LLM call.
    The full conversation history is passed on every request so the model
    can reference earlier turns.
    Returns (content, usage).
    """
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}] + messages,
    )
    return response.choices[0].message.content, _usage(response)


def llm_with_tools(messages: list[dict]) -> tuple[str, dict, list[dict]]:
    """
    Agentic loop with OpenAI function-calling tools.
    Calls the model, executes any tool calls, feeds results back, and
    repeats until the model returns a final text response.
    Returns (content, accumulated_usage, list_of_tool_invocations).
    """
    from tools import TOOLS, execute_tool

    msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    invocations = []

    while True:
        response = client.chat.completions.create(
            model=MODEL,
            messages=msgs,
            tools=TOOLS,
            tool_choice="auto",
        )
        for k, v in _usage(response).items():
            total_usage[k] += v

        msg = response.choices[0].message

        if not msg.tool_calls:
            return msg.content, total_usage, invocations

        # Append the assistant turn that contains the tool call requests
        msgs.append(msg)

        for tc in msg.tool_calls:
            name = tc.function.name
            args = json.loads(tc.function.arguments)
            result = execute_tool(name, args)
            invocations.append({"name": name, "args": args, "result": result})
            msgs.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })


def llm_with_web_search(user_message: str, history: list[dict]) -> tuple[str, dict, str]:
    """
    Two-step web-search pipeline:
      1. Call OpenAI's built-in web_search_preview (Responses API) to get
         a fresh, web-grounded answer for the query.
      2. Feed (search context + original message + optional history) into
         our regular chat completions LLM to produce the final response.
    Returns (final_answer, usage, search_context).
    """
    from web_search import run_web_search

    # Step 1 — live web search via the Responses API
    search_context = run_web_search(user_message)

    # Step 2 — synthesis: inject search results back into our regular LLM
    synthesis_prompt = (
        f"Live web search results:\n\n{search_context}\n\n"
        f"Using the above as context, answer: {user_message}"
    )
    msgs = list(history) + [{"role": "user", "content": synthesis_prompt}]
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}] + msgs,
    )
    return response.choices[0].message.content, _usage(response), search_context
