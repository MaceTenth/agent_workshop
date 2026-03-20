import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# web_search_preview is supported on gpt-4o, gpt-4o-mini, and later models.
# Override with OPENAI_WEB_SEARCH_MODEL in .env if your main model differs.
# https://developers.openai.com/api/docs/guides/tools-web-search?lang=python
WEB_SEARCH_MODEL = os.getenv(
    "OPENAI_WEB_SEARCH_MODEL",
    os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
)


def run_web_search(query: str) -> str:
    """
    Calls OpenAI's built-in web_search_preview tool via the Responses API.
    No extra packages required — just the openai SDK.

    Returns the model's web-grounded answer as a plain string,
    which is then fed as context into our regular LLM pipeline.
    """
    response = client.responses.create(
        model=WEB_SEARCH_MODEL,
        tools=[{"type": "web_search_preview"}],
        input=query,
    )
    return response.output_text
