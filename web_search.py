import os
import anthropic
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic()

# The web_search_20260209 server tool (dynamic filtering) is supported on
# Opus 4.8/4.7/4.6, Sonnet 5, and Sonnet 4.6. Override with
# ANTHROPIC_WEB_SEARCH_MODEL if your main model doesn't support it.
# https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
WEB_SEARCH_MODEL = os.getenv(
    "ANTHROPIC_WEB_SEARCH_MODEL",
    os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5"),
)


def run_web_search(query: str) -> str:
    """
    Calls Claude's built-in web_search server tool. Claude issues the search,
    reads the results, and returns a web-grounded answer — all server-side,
    no client-side execution loop needed.

    Returns the model's web-grounded answer as a plain string,
    which is then fed as context into our regular LLM pipeline.
    """
    response = client.messages.create(
        model=WEB_SEARCH_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": query}],
        tools=[{"type": "web_search_20260209", "name": "web_search"}],
    )
    return "".join(b.text for b in response.content if b.type == "text").strip()
