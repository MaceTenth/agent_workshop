
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
