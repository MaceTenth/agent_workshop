import time
import uuid
import threading
import anthropic
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from llm import simple_llm_call, llm_with_memory, llm_with_tools, llm_with_web_search, llm_with_rag, llm_agent
from agent_llm import run_stock_agent

app = FastAPI(title="Agent Workshop")


@app.middleware("http")
async def no_cache(request, call_next):
    """Serve fresh files during the workshop — no stale browser cache."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


# ── Turn raw Claude API errors into a clean, human-readable message ───────────
_FRIENDLY_ERRORS = {
    401: "Invalid API key — check ANTHROPIC_API_KEY in your .env file.",
    403: "This API key doesn't have access to that model.",
    404: "Model not found — check the model name.",
    429: "Rate limited by the API — wait a few seconds and try again.",
    529: "The API is temporarily overloaded — please retry in a moment.",
}


def _friendly_error(exc: Exception) -> str:
    if isinstance(exc, anthropic.APIConnectionError):
        return "Couldn't reach Claude — check your connection and retry."
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return _FRIENDLY_ERRORS.get(status, f"Claude API error ({status}). Please try again.")
    if isinstance(exc, anthropic.APIError):
        return "Something went wrong talking to Claude. Please try again."
    return "Something went wrong. Please try again."


@app.exception_handler(anthropic.APIError)
async def anthropic_error_handler(request, exc):
    status = getattr(exc, "status_code", None)
    code = status if isinstance(status, int) else (503 if isinstance(exc, anthropic.APIConnectionError) else 502)
    return JSONResponse(status_code=code, content={"error": _friendly_error(exc)})


DEFAULT_MODEL = "claude-sonnet-5"

# ── Per-model pricing (USD per 1M tokens: input, output) for the cost badge ───
PRICES = {
    "claude-sonnet-5": (3.0, 15.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-haiku-4-5": (1.0, 5.0),
}


def _cost(usage: dict, model: str) -> float:
    """Estimate the USD cost of a call from its token usage."""
    in_price, out_price = PRICES.get(model or DEFAULT_MODEL, PRICES[DEFAULT_MODEL])
    return round(
        usage.get("prompt_tokens", 0) / 1e6 * in_price
        + usage.get("completion_tokens", 0) / 1e6 * out_price,
        6,
    )


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    tools_enabled: bool = False
    web_search_enabled: bool = False
    rag_enabled: bool = False
    agent_mode: bool = False
    model: str | None = None


class PlanRequest(BaseModel):
    task: str
    mode: str  # zero_shot | few_shot | cot | decompose | react
    model: str | None = None


class AgentRequest(BaseModel):
    ticker: str
    risk_tolerance: str = "moderate"
    model: str | None = None


@app.post("/agent")
def agent(request: AgentRequest):
    t0 = time.perf_counter()
    result = run_stock_agent(request.ticker, request.risk_tolerance, model=request.model)
    result["latency_ms"] = round((time.perf_counter() - t0) * 1000)
    result["cost_usd"] = _cost(result.get("usage", {}), request.model)
    result["model"] = request.model or DEFAULT_MODEL
    return result


# ── Live agent runs: start in a background thread, poll for progress ──────────
AGENT_JOBS: dict = {}


@app.post("/agent/start")
def agent_start(request: AgentRequest):
    job_id = uuid.uuid4().hex
    job = {"progress": [], "done": False, "result": None, "error": None}
    AGENT_JOBS[job_id] = job

    def worker():
        t0 = time.perf_counter()
        try:
            result = run_stock_agent(
                request.ticker, request.risk_tolerance, model=request.model,
                emit=lambda ev: job["progress"].append(ev),
            )
            result["latency_ms"] = round((time.perf_counter() - t0) * 1000)
            result["cost_usd"] = _cost(result.get("usage", {}), request.model)
            result["model"] = request.model or DEFAULT_MODEL
            job["result"] = result
        except Exception as exc:  # noqa: BLE001 — surface a friendly message
            job["error"] = _friendly_error(exc)
        finally:
            job["done"] = True

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id}


@app.get("/agent/status/{job_id}")
def agent_status(job_id: str):
    job = AGENT_JOBS.get(job_id)
    if job is None:
        return JSONResponse(status_code=404, content={"error": "Unknown or expired job."})
    return {"progress": job["progress"], "done": job["done"],
            "result": job["result"], "error": job["error"]}


@app.post("/plan")
def plan(request: PlanRequest):
    from planning_llm import zero_shot, few_shot, chain_of_thought, decompose_task, react_loop

    t0 = time.perf_counter()
    mdl = request.model

    if request.mode == "zero_shot":
        content, usage = zero_shot(request.task, model=mdl)
        out = {"content": content, "usage": usage}
    elif request.mode == "few_shot":
        content, usage = few_shot(request.task, model=mdl)
        out = {"content": content, "usage": usage}
    elif request.mode == "cot":
        content, usage = chain_of_thought(request.task, model=mdl)
        out = {"content": content, "usage": usage}
    elif request.mode == "decompose":
        content, usage, steps = decompose_task(request.task, model=mdl)
        out = {"content": content, "usage": usage, "steps": steps}
    elif request.mode == "react":
        steps, usage = react_loop(request.task, model=mdl)
        out = {"steps": steps, "usage": usage}
    else:
        return {"error": f"Unknown mode: {request.mode}"}

    out["latency_ms"] = round((time.perf_counter() - t0) * 1000)
    out["cost_usd"] = _cost(out.get("usage", {}), mdl)
    out["model"] = mdl or DEFAULT_MODEL
    return out


@app.post("/chat")
def chat(request: ChatRequest):
    base = request.history + [{"role": "user", "content": request.message}]
    tool_invocations: list[dict] = []
    search_context: str = ""
    rag_context: str = ""
    trace: dict = {}
    mdl = request.model

    t0 = time.perf_counter()
    if request.agent_mode:
        response, usage, tool_invocations, rag_context = llm_agent(
            request.message, request.history,
            tools_enabled=request.tools_enabled,
            web_search_enabled=request.web_search_enabled,
            rag_enabled=request.rag_enabled,
            model=mdl, trace=trace,
        )
    elif request.rag_enabled:
        response, usage, rag_context = llm_with_rag(request.message, request.history, model=mdl, trace=trace)
    elif request.web_search_enabled:
        response, usage, search_context = llm_with_web_search(request.message, request.history, model=mdl, trace=trace)
    elif request.tools_enabled:
        response, usage, tool_invocations = llm_with_tools(base, model=mdl, trace=trace)
    elif request.history:
        response, usage = llm_with_memory(base, model=mdl, trace=trace)
    else:
        response, usage = simple_llm_call(request.message, model=mdl, trace=trace)

    return {
        "response": response,
        "usage": usage,
        "tool_calls": tool_invocations,
        "search_context": search_context,
        "rag_context": rag_context,
        "latency_ms": round((time.perf_counter() - t0) * 1000),
        "cost_usd": _cost(usage, mdl),
        "model": mdl or DEFAULT_MODEL,
        "request_preview": trace.get("preview"),
    }


# Serve the frontend — must be mounted last so the API routes take priority
app.mount("/", StaticFiles(directory="static", html=True), name="static")
