
## Web Search Tools

### 1. Tavily Search

Tavily is purpose-built for LLM agents — it returns pre-filtered, citation-ready results.

**Install**
```bash
pip install tavily-python
```

**.env**
```
TAVILY_API_KEY=tvly-...
```

**Schema**
```python
{
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for up-to-date information on any topic.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of results to return (default 5)",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    }
}
```

**Implementation**
```python
import os
from tavily import TavilyClient

def _web_search(query: str, max_results: int = 5) -> str:
    client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
    results = client.search(query=query, max_results=max_results)
    lines = []
    for r in results.get("results", []):
        lines.append(f"- [{r['title']}]({r['url']})\n  {r['content'][:200]}")
    return "\n".join(lines) or "No results found."
```

**Try it:** *"What's the latest news about OpenAI?"*

---

### 2. Firecrawl — Scrape & Crawl

Firecrawl turns any URL into clean Markdown, ready to be injected into an LLM prompt.

**Install**
```bash
pip install firecrawl-py
```

**.env**
```
FIRECRAWL_API_KEY=fc-...
```

**Schema**
```python
{
    "type": "function",
    "function": {
        "name": "scrape_url",
        "description": (
            "Fetch and return the main content of a webpage as clean Markdown. "
            "Use this when the user provides a URL or asks you to read a page."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The full URL to scrape, e.g. 'https://example.com/article'"
                }
            },
            "required": ["url"]
        }
    }
}
```

**Implementation**
```python
import os
from firecrawl import FirecrawlApp

def _scrape_url(url: str) -> str:
    app = FirecrawlApp(api_key=os.getenv("FIRECRAWL_API_KEY"))
    result = app.scrape_url(url, params={"formats": ["markdown"]})
    content = result.get("markdown", "")
    # Trim to avoid blowing up the context window
    return content[:4000] if content else "Could not retrieve content."
```

**Try it:** *"Summarise https://en.wikipedia.org/wiki/Large_language_model"*

---

### 3. Firecrawl — Deep Research Crawl

Crawl an entire site and aggregate the content for research tasks.

**Schema**
```python
{
    "type": "function",
    "function": {
        "name": "crawl_site",
        "description": "Crawl multiple pages of a website and return aggregated content.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Root URL to start crawling from"
                },
                "max_pages": {
                    "type": "integer",
                    "description": "Maximum number of pages to crawl (default 5)",
                    "default": 5
                }
            },
            "required": ["url"]
        }
    }
}
```

**Implementation**
```python
def _crawl_site(url: str, max_pages: int = 5) -> str:
    app = FirecrawlApp(api_key=os.getenv("FIRECRAWL_API_KEY"))
    result = app.crawl_url(
        url,
        params={"limit": max_pages, "scrapeOptions": {"formats": ["markdown"]}}
    )
    pages = result.get("data", [])
    chunks = [p.get("markdown", "")[:800] for p in pages if p.get("markdown")]
    return "\n\n---\n\n".join(chunks) or "No content retrieved."
```

---

### 4. Brave Search API

Privacy-focused search with a generous free tier (2,000 calls/month).

**Install** — uses `httpx` (already available via FastAPI)

**.env**
```
BRAVE_API_KEY=BSA...
```

**Schema**
```python
{
    "type": "function",
    "function": {
        "name": "brave_search",
        "description": "Search the web using Brave Search.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "count": {
                    "type": "integer",
                    "description": "Number of results (1–20, default 5)",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    }
}
```

**Implementation**
```python
import os
import httpx

def _brave_search(query: str, count: int = 5) -> str:
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": os.getenv("BRAVE_API_KEY"),
    }
    params = {"q": query, "count": count}
    resp = httpx.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers=headers, params=params, timeout=10
    )
    resp.raise_for_status()
    results = resp.json().get("web", {}).get("results", [])
    lines = [f"- [{r['title']}]({r['url']})\n  {r.get('description','')[:200]}" for r in results]
    return "\n".join(lines) or "No results."
```

---

### 5. SerpAPI (Google, Bing, Yahoo…)

A unified API for many search engines with rich structured responses.

**Install**
```bash
pip install google-search-results
```

**.env**
```
SERPAPI_API_KEY=...
```

**Implementation**
```python
import os
from serpapi import GoogleSearch

def _serpapi_search(query: str, num: int = 5) -> str:
    params = {
        "q": query,
        "num": num,
        "api_key": os.getenv("SERPAPI_API_KEY"),
    }
    results = GoogleSearch(params).get_dict()
    organic = results.get("organic_results", [])
    lines = [f"- [{r['title']}]({r['link']})\n  {r.get('snippet','')[:200]}" for r in organic]
    return "\n".join(lines) or "No results."
```

---

### 6. Wikipedia Summary

Free, no API key required — great for factual, encyclopaedic lookups.

**Install**
```bash
pip install wikipedia-api
```

**Schema**
```python
{
    "type": "function",
    "function": {
        "name": "wikipedia_summary",
        "description": "Fetch a concise summary of a topic from Wikipedia.",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Topic to look up"}
            },
            "required": ["topic"]
        }
    }
}
```

**Implementation**
```python
import wikipediaapi

def _wikipedia_summary(topic: str) -> str:
    wiki = wikipediaapi.Wikipedia(
        language="en",
        user_agent="agent-workshop/1.0"
    )
    page = wiki.page(topic)
    if not page.exists():
        return f"No Wikipedia page found for '{topic}'."
    return page.summary[:2000]
```

---

## How to wire a new tool into `tools.py`

1. **Add the schema** to the `TOOLS` list
2. **Write the implementation** function (`_my_tool(...)`)
3. **Add a branch** in `execute_tool()`:

```python
def execute_tool(name: str, arguments: dict) -> str:
    if name == "get_datetime":
        return _get_datetime()
    if name == "calculate":
        return _calculate(arguments.get("expression", ""))
    # ← add here
    if name == "web_search":
        return _web_search(arguments["query"], arguments.get("max_results", 5))
    if name == "scrape_url":
        return _scrape_url(arguments["url"])
    return f"Unknown tool: {name}"
```

That's it — the agentic loop in `llm.py` will automatically call it when the model decides it's needed.

---

## Choosing the right tool

| Need | Tool |
|---|---|
| Real-time news / current events | Tavily, Brave Search |
| Read a specific webpage | Firecrawl scrape |
| Research an entire site | Firecrawl crawl |
| Google-quality web results | SerpAPI |
| Factual / encyclopaedic lookups | Wikipedia |
| Privacy-focused, free tier | Brave Search |
| Interact with a live page (login, click, fill forms) | browser-use / Playwright |
| Scrape JS-heavy SPAs that Firecrawl can't reach | Playwright / Puppeteer |
| Reuse your real Chrome cookies & session | browser-use `--profile` |
| Run automation in CI / headless cloud | Playwright / browser-use cloud |

---

## Browser Automation Tools

When a page requires JavaScript rendering, login sessions, or real interaction (clicking, form filling, file upload), plain HTTP scrapers fall short. The tools below give an agent a full browser it can drive programmatically.

---

### 7. browser-use (Python SDK + CLI)

browser-use is purpose-built for AI agents — it exposes a high-level async API that lets an LLM control a Chromium browser, extract structured data, and interact with any page, including behind login walls.

**Docs:** https://docs.browser-use.com/open-source/browser-use-cli

**Install**
```bash
# Recommended: install via installer (handles Chromium too)
curl -fsSL https://browser-use.com/cli/install.sh | bash

# Or manually with pip/uv
pip install browser-use
browser-use install   # downloads Chromium
browser-use doctor    # validate installation
```

**.env**
```
# Only needed for cloud features
BROWSER_USE_API_KEY=sk-...
```

**CLI quick reference**
```bash
browser-use open https://example.com   # navigate (starts daemon on first run)
browser-use state                      # list page title + all clickable elements with indices
browser-use click 5                    # click element #5
browser-use input 3 "hello@example.com" # click input #3 then type
browser-use screenshot output.png      # capture screenshot
browser-use eval "document.title"      # run JS and return result
browser-use close                      # close browser & daemon

# Browser mode flags
browser-use --headed open https://...       # visible window
browser-use --profile "Default" open ...   # use your real Chrome + cookies
browser-use --connect open ...             # connect to already-running Chrome
```

**Python SDK (async) — tool implementation**
```python
from browser_use import Agent, Browser, BrowserConfig
from langchain_openai import ChatOpenAI  # browser-use integrates with LangChain
import asyncio

async def _browser_task(task: str, url: str = None) -> str:
    """
    Give the agent a natural-language task and an optional starting URL.
    Returns the agent's final answer as a string.
    """
    browser = Browser(config=BrowserConfig(headless=True))
    agent = Agent(
        task=f"{task}" + (f" Start at: {url}" if url else ""),
        llm=ChatOpenAI(model="gpt-4o-mini"),
        browser=browser,
    )
    result = await agent.run()
    await browser.close()
    return str(result)

# Synchronous wrapper for use in tools.py
def browser_task(task: str, url: str = None) -> str:
    return asyncio.run(_browser_task(task, url))
```

**OpenAI tool schema**
```python
{
    "type": "function",
    "function": {
        "name": "browser_task",
        "description": (
            "Control a real browser to navigate pages, click elements, fill forms, "
            "and extract data from JavaScript-heavy or login-protected sites. "
            "Describe the full task in natural language."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Natural-language instruction for the browser agent, e.g. 'Go to twitter.com and get the top 3 trending topics'"
                },
                "url": {
                    "type": "string",
                    "description": "Optional starting URL"
                }
            },
            "required": ["task"]
        }
    }
}
```

**Try it:** *"Go to news.ycombinator.com and return the top 5 story titles"*

---

### 8. Playwright (Python)

Playwright is Microsoft's browser automation library — the gold standard for scraping JS-heavy pages, running tests, and precise interaction scripts. It supports Chromium, Firefox, and WebKit.

**Docs:** https://playwright.dev/python/

**Install**
```bash
pip install playwright
playwright install chromium   # or: playwright install  (all browsers)
```

**Tool implementation**
```python
from playwright.sync_api import sync_playwright

def _playwright_scrape(url: str, selector: str = None) -> str:
    """
    Navigate to a URL, wait for JS to render, and return page text.
    Optionally target a CSS selector to extract a specific section.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="networkidle", timeout=30_000)
        if selector:
            el = page.query_selector(selector)
            text = el.inner_text() if el else "Selector not found."
        else:
            text = page.inner_text("body")
        browser.close()
    return text[:4000]  # trim to avoid blowing up context window

def _playwright_screenshot(url: str, path: str = "screenshot.png") -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="networkidle", timeout=30_000)
        page.screenshot(path=path, full_page=True)
        browser.close()
    return f"Screenshot saved to {path}"
```

**OpenAI tool schema**
```python
{
    "type": "function",
    "function": {
        "name": "playwright_scrape",
        "description": (
            "Scrape a JavaScript-rendered page and return its text content. "
            "Use when Firecrawl or plain HTTP fetching fails on SPAs or dynamic sites."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Page URL to scrape"},
                "selector": {
                    "type": "string",
                    "description": "Optional CSS selector to target a specific element"
                }
            },
            "required": ["url"]
        }
    }
}
```

**Try it:** *"Get the rendered text from https://react-example.com/dashboard"*

---

### 9. Puppeteer (`pyppeteer` / Node `puppeteer`)

Puppeteer is Google's browser automation library that drives Chrome/Chromium over the Chrome DevTools Protocol (CDP). The Python port is `pyppeteer`; for full feature parity, the Node.js version is canonical.

**Docs:** https://pptr.dev

**Install (Python port)**
```bash
pip install pyppeteer
```

**Tool implementation (Python)**
```python
import asyncio
from pyppeteer import launch

async def _puppeteer_scrape_async(url: str) -> str:
    browser = await launch(headless=True, args=["--no-sandbox"])
    page = await browser.newPage()
    await page.goto(url, {"waitUntil": "networkidle2"})
    text = await page.evaluate("document.body.innerText")
    await browser.close()
    return text[:4000]

# Synchronous wrapper
def _puppeteer_scrape(url: str) -> str:
    return asyncio.run(_puppeteer_scrape_async(url))
```

**Note:** For production use, prefer Playwright (actively maintained, better cross-browser support). Use Puppeteer if you are already on a Node.js stack or need CDP-specific features.

---

## Comparison: Browser Automation Tools

| | browser-use | Playwright | Puppeteer |
|---|---|---|---|
| **Language** | Python (async) | Python / JS / TS | JS/TS (Python port) |
| **LLM-native** | ✅ built-in agent loop | ❌ manual scripting | ❌ manual scripting |
| **Browsers** | Chromium | Chromium / Firefox / WebKit | Chromium only |
| **Headless** | ✅ | ✅ | ✅ |
| **Real Chrome + cookies** | ✅ `--profile` flag | ⚠️ via persistent context | ⚠️ executablePath trick |
| **Cloud mode** | ✅ managed API | ❌ self-host | ❌ self-host |
| **Best for** | Agent-driven tasks | Scraping & testing | CDP / Node.js stacks |
| **Maintenance** | Active (2024–) | Active (Microsoft) | Active (Google) |
