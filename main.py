from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from llm import simple_llm_call, llm_with_memory, llm_with_tools, llm_with_web_search

app = FastAPI(title="Agent Workshop")


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    tools_enabled: bool = False
    web_search_enabled: bool = False


@app.post("/chat")
async def chat(request: ChatRequest):
    base = request.history + [{"role": "user", "content": request.message}]
    tool_invocations: list[dict] = []
    search_context: str = ""

    if request.web_search_enabled:
        response, usage, search_context = llm_with_web_search(request.message, request.history)
    elif request.tools_enabled:
        response, usage, tool_invocations = llm_with_tools(base)
    elif request.history:
        response, usage = llm_with_memory(base)
    else:
        response, usage = simple_llm_call(request.message)

    return {
        "response": response,
        "usage": usage,
        "tool_calls": tool_invocations,
        "search_context": search_context,
    }


# Serve the frontend — must be mounted last so the API routes take priority
app.mount("/", StaticFiles(directory="static", html=True), name="static")
