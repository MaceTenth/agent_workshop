import time
import uuid
import threading
import anthropic
import openai
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from llm import simple_llm_call, llm_with_memory, llm_with_tools, llm_with_web_search, llm_with_rag, llm_agent
from agent_llm import run_stock_agent
from providers import MODEL_CATALOG, DEFAULT_MODEL as PROVIDER_DEFAULT_MODEL, key_status, MissingAPIKeyError

app = FastAPI(title="Agent Workshop")


@app.middleware("http")
async def no_cache(request, call_next):
    """Serve fresh files during the workshop — no stale browser cache."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


# ── Turn raw provider API errors into a clean, human-readable message ─────────
_FRIENDLY_ERRORS = {
    401: "Invalid API key — check your .env file for the selected provider.",
    403: "This API key doesn't have access to that model.",
    404: "Model not found — check the model name.",
    429: "Rate limited by the API — wait a few seconds and try again.",
    529: "The API is temporarily overloaded — please retry in a moment.",
}


def _friendly_error(exc: Exception) -> str:
    if isinstance(exc, MissingAPIKeyError):
        return str(exc)
    if isinstance(exc, (anthropic.APIConnectionError, openai.APIConnectionError)):
        return "Couldn't reach the model provider — check your connection and retry."
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return _FRIENDLY_ERRORS.get(status, f"API error ({status}). Please try again.")
    if isinstance(exc, (anthropic.APIError, openai.APIError)):
        return "Something went wrong talking to the model provider. Please try again."
    return "Something went wrong. Please try again."


def _error_status(exc: Exception) -> int:
    if isinstance(exc, MissingAPIKeyError):
        return 400
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status
    if isinstance(exc, (anthropic.APIConnectionError, openai.APIConnectionError)):
        return 503
    return 502


@app.exception_handler(MissingAPIKeyError)
async def missing_key_handler(request, exc):
    return JSONResponse(status_code=400, content={"error": _friendly_error(exc)})


@app.exception_handler(anthropic.APIError)
async def anthropic_error_handler(request, exc):
    return JSONResponse(status_code=_error_status(exc), content={"error": _friendly_error(exc)})


@app.exception_handler(openai.APIError)
async def openai_error_handler(request, exc):
    return JSONResponse(status_code=_error_status(exc), content={"error": _friendly_error(exc)})


DEFAULT_MODEL = PROVIDER_DEFAULT_MODEL

# ── Per-model pricing (USD per 1M tokens: input, output) for the cost badge ───
PRICES = {
    model: cfg["price"]
    for models in MODEL_CATALOG.values()
    for model, cfg in models.items()
}


@app.get("/config")
def config():
    """Model catalog + which providers have an API key configured, so the
    frontend can populate the picker and show a warning for missing keys."""
    return {"models": MODEL_CATALOG, "keys": key_status(), "default_model": DEFAULT_MODEL}


class TokenizeRequest(BaseModel):
    text: str = ""
    model: str | None = None


@app.post("/count_tokens")
def count_tokens(request: TokenizeRequest):
    """Accurate Claude token count via Anthropic's count_tokens API — used by
    the Tokenizer page to compare Claude's tokenizer against GPT's (which the
    page computes client-side). Anthropic exposes only the count, not the token
    strings, so there are no segments to return — just the number."""
    from providers import anthropic_client, require_key

    mdl = request.model or DEFAULT_MODEL
    if not request.text.strip():
        return {"input_tokens": 0, "model": mdl}
    require_key("anthropic")
    resp = anthropic_client().messages.count_tokens(
        model=mdl, messages=[{"role": "user", "content": request.text}],
    )
    return {"input_tokens": resp.input_tokens, "model": mdl}


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
    effort: str | None = None  # Anthropic reasoning depth; ignored by other models


class PlanRequest(BaseModel):
    task: str
    mode: str  # zero_shot | few_shot | cot | decompose | react
    model: str | None = None
    effort: str | None = None


class AgentRequest(BaseModel):
    ticker: str
    risk_tolerance: str = "moderate"
    model: str | None = None
    effort: str | None = None


@app.post("/agent")
def agent(request: AgentRequest):
    t0 = time.perf_counter()
    result = run_stock_agent(request.ticker, request.risk_tolerance, model=request.model, effort=request.effort)
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
                emit=lambda ev: job["progress"].append(ev), effort=request.effort,
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
    eff = request.effort

    if request.mode == "zero_shot":
        content, usage = zero_shot(request.task, model=mdl, effort=eff)
        out = {"content": content, "usage": usage}
    elif request.mode == "few_shot":
        content, usage = few_shot(request.task, model=mdl, effort=eff)
        out = {"content": content, "usage": usage}
    elif request.mode == "cot":
        content, usage = chain_of_thought(request.task, model=mdl, effort=eff)
        out = {"content": content, "usage": usage}
    elif request.mode == "decompose":
        content, usage, steps = decompose_task(request.task, model=mdl, effort=eff)
        out = {"content": content, "usage": usage, "steps": steps}
    elif request.mode == "react":
        steps, usage = react_loop(request.task, model=mdl, effort=eff)
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
    eff = request.effort

    t0 = time.perf_counter()
    if request.agent_mode:
        response, usage, tool_invocations, rag_context = llm_agent(
            request.message, request.history,
            tools_enabled=request.tools_enabled,
            web_search_enabled=request.web_search_enabled,
            rag_enabled=request.rag_enabled,
            model=mdl, trace=trace, effort=eff,
        )
    elif request.rag_enabled:
        response, usage, rag_context = llm_with_rag(request.message, request.history, model=mdl, trace=trace, effort=eff)
    elif request.web_search_enabled:
        response, usage, search_context = llm_with_web_search(request.message, request.history, model=mdl, trace=trace, effort=eff)
    elif request.tools_enabled:
        response, usage, tool_invocations = llm_with_tools(base, model=mdl, trace=trace, effort=eff)
    elif request.history:
        response, usage = llm_with_memory(base, model=mdl, trace=trace, effort=eff)
    else:
        response, usage = simple_llm_call(request.message, model=mdl, trace=trace, effort=eff)

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
