# Agent Workshop

A hands-on FastAPI application that walks through the building blocks of AI agents — from stateless LLM calls to full agentic loops — step by step.

## Features

| Module | What it demonstrates |
|---|---|
| **Stateless LLM** | Single, context-free call to the model |
| **Memory** | Full conversation history passed on every request |
| **Tools** | OpenAI function-calling (calculator, datetime) |
| **Web Search** | Live grounding via OpenAI's `web_search_preview` |
| **RAG** | Retrieve → Augment → Generate with in-memory employee data |
| **Planning** | Zero-shot, few-shot, chain-of-thought, decomposition, ReAct |
| **Agent** | Multi-step stock analysis agent (Plan → Execute → Synthesise → Verify) |

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/agent_workshop.git
cd agent_workshop
```

### 2. Configure your API key

```bash
cp .env.example .env
# Edit .env and replace sk-... with your actual OpenAI API key
```

The `.env` file is listed in `.gitignore` and is **never** committed to the repository.

### 3. Start the server

```bash
./start.sh
```

The script will:
- Create a Python virtual environment (`.venv`) if one does not exist
- Install all dependencies from `requirements.txt`
- Start the FastAPI server at `http://127.0.0.1:8000`
- Open the UI in your browser automatically

#### Share mode (ngrok)

To give participants a public URL:

```bash
./start.sh --share
```

Requires [ngrok](https://ngrok.com) to be installed and authenticated.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used for all LLM calls |

## Sensitive Data Notice

- **API keys** are loaded exclusively from the `.env` file, which is gitignored. No secrets are ever committed to the repository.
- The employee records in `rag.py` are **entirely fictional** demo data invented for the RAG workshop module. They do not represent real people.
