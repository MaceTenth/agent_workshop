"""
providers.py — shared multi-provider config for the workshop app.

Lets every module (llm.py, planning_llm.py, agent_llm.py, main.py) pick
between Anthropic (Claude) and OpenAI (GPT) models using one shared model
catalog, and share the "is the API key configured?" check that powers the
frontend warning banner.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── Model catalog: which provider each model belongs to, plus pricing ────────
# Prices are USD per 1M tokens: (input, output) — used for the cost badge.
MODEL_CATALOG = {
    "anthropic": {
        "claude-sonnet-5":  {"label": "Sonnet 5",     "price": (3.0, 15.0)},
        "claude-opus-4-8":  {"label": "Opus 4.8",     "price": (5.0, 25.0)},
        "claude-haiku-4-5": {"label": "Haiku 4.5",    "price": (1.0, 5.0)},
    },
    "openai": {
        "gpt-4.1":      {"label": "GPT-4.1",      "price": (2.0, 8.0)},
        "gpt-4o":       {"label": "GPT-4o",       "price": (2.5, 10.0)},
        "gpt-4.1-mini": {"label": "GPT-4.1 Mini", "price": (0.4, 1.6)},
    },
}

DEFAULT_PROVIDER = "anthropic"
DEFAULT_MODEL = "claude-sonnet-5"

# ── Effort: Anthropic reasoning-depth control via output_config.effort ────────
# Only these Anthropic models accept `effort` — Haiku 4.5 and all OpenAI models
# reject it (400), so effort is silently ignored for anything not listed here.
EFFORT_MODELS = {
    "claude-sonnet-5", "claude-sonnet-4-6",
    "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
}
EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")


def supports_effort(model: str | None) -> bool:
    return model in EFFORT_MODELS


def effort_kwargs(model: str | None, effort: str | None) -> dict:
    """{'output_config': {'effort': ...}} when the model supports effort and a
    valid level was chosen; otherwise {} — a no-op for Haiku/OpenAI/no-choice."""
    if effort in EFFORT_LEVELS and supports_effort(model):
        return {"output_config": {"effort": effort}}
    return {}

_API_KEY_ENV = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}


def provider_for_model(model: str | None) -> str:
    """Infer which provider a model id belongs to. Falls back to the default."""
    if not model:
        return DEFAULT_PROVIDER
    for provider, models in MODEL_CATALOG.items():
        if model in models:
            return provider
    return DEFAULT_PROVIDER


def price_for_model(model: str | None) -> tuple[float, float]:
    provider = provider_for_model(model)
    models = MODEL_CATALOG[provider]
    return models.get(model, models[next(iter(models))])["price"]


def has_api_key(provider: str) -> bool:
    return bool(os.getenv(_API_KEY_ENV.get(provider, ""), "").strip())


def key_status() -> dict:
    """{'anthropic': bool, 'openai': bool} — used by the /config endpoint to
    drive the frontend's 'no API key configured' warning banner."""
    return {provider: has_api_key(provider) for provider in MODEL_CATALOG}


class MissingAPIKeyError(RuntimeError):
    """Raised when a call is attempted against a provider with no API key set."""

    def __init__(self, provider: str):
        env = _API_KEY_ENV.get(provider, "API_KEY")
        self.provider = provider
        super().__init__(
            f"No {env} configured. Add it to your .env file to use "
            f"{provider.title()} models."
        )


def require_key(provider: str) -> None:
    if not has_api_key(provider):
        raise MissingAPIKeyError(provider)


# ── Lazily-constructed SDK clients (avoid erroring out at import time when a
# key is missing — the error should surface only when that provider is used) ─
_clients: dict = {}


def anthropic_client():
    if "anthropic" not in _clients:
        import anthropic
        _clients["anthropic"] = anthropic.Anthropic()
    return _clients["anthropic"]


def openai_client():
    if "openai" not in _clients:
        import openai
        _clients["openai"] = openai.OpenAI()
    return _clients["openai"]


# ── Tool-schema conversion: Anthropic input_schema <-> OpenAI function schema ─

def to_openai_tools(tools: list[dict]) -> list[dict]:
    """Convert Anthropic-style tool defs ({name, description, input_schema})
    into OpenAI's {"type": "function", "function": {...}} shape."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
            },
        }
        for t in tools
    ]


# ── Message conversion: Anthropic content-block messages -> OpenAI messages ──

def to_openai_messages(system: str, messages: list[dict]) -> list[dict]:
    """
    Convert our internal Anthropic-shaped message list (role: user/assistant,
    content: str or list of blocks such as tool_use/tool_result) into the
    flat role-based list OpenAI's Chat Completions API expects.
    """
    out = [{"role": "system", "content": system}]
    for msg in messages:
        role = msg["role"]
        content = msg["content"]

        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue

        # content is a list of Anthropic content blocks
        text_parts = []
        tool_calls = []
        tool_results = []
        for block in content:
            btype = block.type if hasattr(block, "type") else block.get("type")
            if btype == "text":
                text_parts.append(block.text if hasattr(block, "text") else block.get("text", ""))
            elif btype == "tool_use":
                name = block.name if hasattr(block, "name") else block["name"]
                input_ = block.input if hasattr(block, "input") else block["input"]
                call_id = block.id if hasattr(block, "id") else block["id"]
                tool_calls.append({
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": __import__("json").dumps(input_)},
                })
            elif btype == "tool_result":
                tool_use_id = block["tool_use_id"] if isinstance(block, dict) else block.tool_use_id
                result_content = block["content"] if isinstance(block, dict) else block.content
                tool_results.append((tool_use_id, result_content))

        if tool_results:
            # Anthropic groups all tool results into one "user" message;
            # OpenAI needs one "tool" role message per result instead.
            for tool_use_id, result_content in tool_results:
                out.append({"role": "tool", "tool_call_id": tool_use_id, "content": str(result_content)})
        elif tool_calls:
            out.append({"role": "assistant", "content": "".join(text_parts) or None, "tool_calls": tool_calls})
        else:
            out.append({"role": role, "content": "".join(text_parts)})
    return out


def openai_usage(response) -> dict:
    u = response.usage
    return {
        "prompt_tokens": u.prompt_tokens,
        "completion_tokens": u.completion_tokens,
        "total_tokens": u.total_tokens,
    }


def openai_text(response) -> str:
    return response.choices[0].message.content or ""


def anthropic_usage(response) -> dict:
    u = response.usage
    return {
        "prompt_tokens": u.input_tokens,
        "completion_tokens": u.output_tokens,
        "total_tokens": u.input_tokens + u.output_tokens,
    }


def anthropic_text(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text")


def complete(mdl, system, messages, max_tokens=2048, tools=None,
             use_context_mgmt=False, cm_beta=None, cm_edit=None, effort=None):
    """
    Provider-agnostic single-turn completion, shared by every module that
    just needs "system + messages in, text + usage out" (no tool loop).
    Dispatches to Anthropic or OpenAI based on the model id.
    Returns (text, usage, raw_response, provider).
    """
    provider = provider_for_model(mdl)
    require_key(provider)

    if provider == "anthropic":
        client = anthropic_client()
        kwargs = dict(model=mdl, max_tokens=max_tokens, system=system, messages=messages)
        if tools:
            kwargs["tools"] = tools
        kwargs.update(effort_kwargs(mdl, effort))
        if use_context_mgmt and mdl in {
            "claude-sonnet-5", "claude-sonnet-4-6",
            "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
        }:
            response = client.beta.messages.create(
                betas=[cm_beta], context_management={"edits": [cm_edit]}, **kwargs,
            )
        else:
            response = client.messages.create(**kwargs)
        return anthropic_text(response), anthropic_usage(response), response, provider

    client = openai_client()
    oa_messages = to_openai_messages(system, messages)
    kwargs = dict(model=mdl, max_tokens=max_tokens, messages=oa_messages)
    if tools:
        kwargs["tools"] = to_openai_tools(tools)
    response = client.chat.completions.create(**kwargs)
    return openai_text(response), openai_usage(response), response, provider
