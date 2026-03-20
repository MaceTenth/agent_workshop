from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from llm import simple_llm_call, llm_with_memory, llm_with_tools, llm_with_web_search, llm_with_rag
from agent_llm import run_stock_agent

app = FastAPI(title="Agent Workshop")


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    tools_enabled: bool = False
    web_search_enabled: bool = False
    rag_enabled: bool = False


class PlanRequest(BaseModel):
    task: str
    mode: str  # zero_shot | few_shot | cot | decompose | react


class AgentRequest(BaseModel):
    ticker: str


@app.post("/agent")
async def agent(request: AgentRequest):
    result = run_stock_agent(request.ticker)
    return result


@app.post("/plan")
async def plan(request: PlanRequest):
    from planning_llm import zero_shot, few_shot, chain_of_thought, decompose_task, react_loop

    if request.mode == "zero_shot":
        content, usage = zero_shot(request.task)
        return {"content": content, "usage": usage}
    elif request.mode == "few_shot":
        content, usage = few_shot(request.task)
        return {"content": content, "usage": usage}
    elif request.mode == "cot":
        content, usage = chain_of_thought(request.task)
        return {"content": content, "usage": usage}
    elif request.mode == "decompose":
        content, usage, steps = decompose_task(request.task)
        return {"content": content, "usage": usage, "steps": steps}
    elif request.mode == "react":
        steps, usage = react_loop(request.task)
        return {"steps": steps, "usage": usage}
    else:
        return {"error": f"Unknown mode: {request.mode}"}


@app.post("/chat")
async def chat(request: ChatRequest):
    base = request.history + [{"role": "user", "content": request.message}]
    tool_invocations: list[dict] = []
    search_context: str = ""
    rag_context: str = ""

    if request.rag_enabled:
        response, usage, rag_context = llm_with_rag(request.message, request.history)
    elif request.web_search_enabled:
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
        "rag_context": rag_context,
    }


# Serve the frontend — must be mounted last so the API routes take priority
app.mount("/", StaticFiles(directory="static", html=True), name="static")
