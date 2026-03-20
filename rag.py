"""
rag.py — Simple in-memory RAG demo (no embeddings, no vector database).

The "knowledge base" is a list of employee records stored as plain dicts.
Retrieval is done with keyword matching across all fields — enough to
illustrate the Retrieve → Augment → Generate pattern clearly.

In a real system you would replace retrieve() with a vector similarity
search, e.g. OpenAI embeddings + FAISS, Chroma, Pinecone, pgvector, etc.
"""

EMPLOYEES = [
    {"id": "E001", "name": "Alice Johnson",   "age": 34, "department": "Engineering",  "role": "Senior Engineer",     "salary": 95000},
    {"id": "E002", "name": "Bob Martinez",    "age": 29, "department": "Marketing",    "role": "Marketing Analyst",   "salary": 72000},
    {"id": "E003", "name": "Carol White",     "age": 41, "department": "HR",           "role": "HR Manager",          "salary": 88000},
    {"id": "E004", "name": "David Lee",       "age": 25, "department": "Engineering",  "role": "Junior Engineer",     "salary": 68000},
    {"id": "E005", "name": "Emma Davis",      "age": 38, "department": "Finance",      "role": "Finance Director",    "salary": 120000},
    {"id": "E006", "name": "Frank Brown",     "age": 52, "department": "Engineering",  "role": "Principal Engineer",  "salary": 145000},
    {"id": "E007", "name": "Grace Kim",       "age": 31, "department": "Sales",        "role": "Sales Lead",          "salary": 85000},
    {"id": "E008", "name": "Henry Wilson",    "age": 44, "department": "HR",           "role": "HR Specialist",       "salary": 74000},
    {"id": "E009", "name": "Iris Patel",      "age": 27, "department": "Marketing",    "role": "Content Strategist",  "salary": 65000},
    {"id": "E010", "name": "James Thompson",  "age": 36, "department": "Finance",      "role": "Financial Analyst",   "salary": 91000},
    {"id": "E011", "name": "Karen Lopez",     "age": 49, "department": "Engineering",  "role": "VP Engineering",      "salary": 175000},
    {"id": "E012", "name": "Liam Chen",       "age": 23, "department": "Sales",        "role": "Sales Representative","salary": 55000},
]


def retrieve(query: str, top_k: int = 5) -> list[dict]:
    """
    Keyword-based retrieval over the in-memory employee store.

    Scores each record by the number of query tokens that appear anywhere
    in its field values.  Falls back to returning the first `top_k` records
    when nothing matches (so the LLM always has some data to work with).
    """
    tokens = [t for t in query.lower().split() if len(t) > 2]
    scored = []
    for emp in EMPLOYEES:
        haystack = " ".join(str(v) for v in emp.values()).lower()
        score = sum(1 for t in tokens if t in haystack)
        if score > 0:
            scored.append((score, emp))

    scored.sort(reverse=True, key=lambda x: x[0])
    return [emp for _, emp in scored[:top_k]] if scored else EMPLOYEES[:top_k]


def format_docs(records: list[dict]) -> str:
    """Format retrieved records as a compact, readable block for LLM context."""
    lines = ["Employee Records (retrieved):"]
    for emp in records:
        lines.append(
            f"  [{emp['id']}] {emp['name']}, age {emp['age']}, "
            f"{emp['role']} in {emp['department']}, salary ${emp['salary']:,}"
        )
    return "\n".join(lines)
