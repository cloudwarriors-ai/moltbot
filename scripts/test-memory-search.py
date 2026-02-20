#!/usr/bin/env python3
"""
Memory Search Test Harness for test-customer channel training.

Tests the built-in memory search system by querying the SQLite DB directly,
replicating what the bot does when memory_search is called with scope=channel.

Usage:
  # Run inside the container:
  docker exec openclaw python3 /app/scripts/test-memory-search.py

  # Or from host (copies and runs):
  ./scripts/run-memory-test.sh
"""

import sqlite3
import json
import struct
import os
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

# ── Config ──────────────────────────────────────────────────────────────────
DB_PATH = os.environ.get("MEMORY_DB", "/root/.openclaw/memory/main.sqlite")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_KEY", "")
EMBEDDING_MODEL = "text-embedding-3-small"
SCOPE_PREFIX = "memory/customers/test-customer"
MIN_SCORE_DEFAULT = 0.35
MAX_RESULTS = 5

# ── Test Cases ──────────────────────────────────────────────────────────────
# Format: (query_as_user_would_say, expected_answer_substring, description)
TEST_CASES = [
    (
        "hey can I get somebody on a call to talk about this deal?",
        "CloudWarriors",
        "Presales call request → should ask if CW is partner"
    ),
    (
        "Can I get someone to hop on a call?",
        "money",
        "Hop on a call → for money (trained pair #1)"
    ),
    (
        "Can I get presales assistance?",
        "CloudWarriors is the partner",
        "Presales assistance → partner check (trained pair #2)"
    ),
    (
        "there is already a partner on this deal",
        "minimum of $10k",
        "Partner exists → $10k minimum (trained pair #3)"
    ),
    (
        "what is the minimum cost for an implementation?",
        "minimum engagement",
        "Minimum engagement pricing question"
    ),
    (
        "I need an executable SOW",
        "SOW",
        "SOW request → should match SOW-related Q&A"
    ),
    (
        "can you scope out a custom integration?",
        "integration",
        "Custom integration question"
    ),
    (
        "I need a quote on CW paper",
        "quote",
        "Quote request"
    ),
    (
        "Team, availability for a scoping call next week?",
        "scoping",
        "Scoping call availability (first Q&A pair in training)"
    ),
    (
        "what is the deal registration status?",
        "deal",
        "Deal registration question"
    ),
]


# ── Helpers ─────────────────────────────────────────────────────────────────

def get_embedding(text: str) -> list[float]:
    """Get embedding from OpenAI API (or OpenRouter)."""
    if OPENROUTER_API_KEY:
        url = "https://openrouter.ai/api/v1/embeddings"
        key = OPENROUTER_API_KEY
    elif OPENAI_API_KEY:
        url = "https://api.openai.com/v1/embeddings"
        key = OPENAI_API_KEY
    else:
        print("ERROR: No OPENAI_API_KEY or OPENROUTER_KEY set")
        sys.exit(1)

    payload = json.dumps({
        "model": EMBEDDING_MODEL,
        "input": text,
    }).encode()

    req = Request(url, data=payload, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
    })

    try:
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            return data["data"][0]["embedding"]
    except URLError as e:
        print(f"  Embedding API error: {e}")
        return []


def blob_to_vec(blob) -> list[float]:
    """Convert SQLite embedding to Python list. Handles both JSON text and binary BLOB."""
    if isinstance(blob, str):
        return json.loads(blob)
    if isinstance(blob, bytes):
        n = len(blob) // 4
        return list(struct.unpack(f"<{n}f", blob))
    return []


def vec_to_blob(vec: list[float]) -> bytes:
    """Convert Python list to SQLite BLOB (Float32Array buffer)."""
    return struct.pack(f"<{len(vec)}f", *vec)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def search_fts(db: sqlite3.Connection, query: str, prefix: str, limit: int = 20):
    """Full-text search on chunks_fts table with path prefix filter."""
    # FTS5 match query - use simple words
    words = query.split()
    fts_query = " OR ".join(w for w in words if len(w) > 2)
    if not fts_query:
        fts_query = query

    try:
        rows = db.execute(
            "SELECT text, path, start_line, end_line, rank "
            "FROM chunks_fts "
            "WHERE chunks_fts MATCH ? AND path LIKE ? "
            "ORDER BY rank "
            "LIMIT ?",
            (fts_query, f"{prefix}/%", limit)
        ).fetchall()
        return [{"text": r[0][:200], "path": r[1], "lines": f"{r[2]}-{r[3]}", "fts_rank": r[4]} for r in rows]
    except Exception as e:
        return [{"error": str(e)}]


def search_vector(db: sqlite3.Connection, query_vec: list[float], prefix: str, limit: int = 20):
    """Vector similarity search on chunks table with path prefix filter."""
    # Load all chunks for this prefix and compute cosine similarity
    rows = db.execute(
        "SELECT id, text, path, start_line, end_line, embedding "
        "FROM chunks "
        "WHERE model = ? AND path LIKE ?",
        (EMBEDDING_MODEL, f"{prefix}/%")
    ).fetchall()

    scored = []
    for row in rows:
        chunk_id, text, path, start, end, emb_blob = row
        if not emb_blob:
            continue
        chunk_vec = blob_to_vec(emb_blob)
        score = cosine_similarity(query_vec, chunk_vec)
        scored.append({
            "score": round(score, 4),
            "path": path,
            "lines": f"{int(start)}-{int(end)}",
            "text": text[:200],
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]


# ── Main ────────────────────────────────────────────────────────────────────

def run_test(db: sqlite3.Connection, query: str, expected: str, description: str, min_score: float):
    """Run a single test case and return results."""
    print(f"\n{'='*70}")
    print(f"QUERY: \"{query}\"")
    print(f"EXPECT: substring \"{expected}\"")
    print(f"DESC: {description}")
    print(f"{'─'*70}")

    # 1. Get embedding for query
    t0 = time.time()
    query_vec = get_embedding(query)
    embed_ms = int((time.time() - t0) * 1000)

    if not query_vec:
        print(f"  SKIP: Could not get embedding ({embed_ms}ms)")
        return {"status": "skip", "query": query}

    # 2. Vector search
    vec_results = search_vector(db, query_vec, SCOPE_PREFIX, limit=MAX_RESULTS)

    # 3. FTS search
    fts_results = search_fts(db, query, SCOPE_PREFIX, limit=MAX_RESULTS)

    # 4. Check results
    vec_pass = any(expected.lower() in r["text"].lower() for r in vec_results if r["score"] >= min_score)
    vec_any = any(expected.lower() in r["text"].lower() for r in vec_results)
    fts_pass = any(expected.lower() in r.get("text", "").lower() for r in fts_results)

    top_score = vec_results[0]["score"] if vec_results else 0
    above_threshold = [r for r in vec_results if r["score"] >= min_score]

    status = "PASS" if vec_pass or fts_pass else "FAIL"
    if not vec_pass and vec_any:
        status = "BELOW_THRESHOLD"

    print(f"\n  Vector results (top {MAX_RESULTS}, embed={embed_ms}ms):")
    for i, r in enumerate(vec_results[:MAX_RESULTS]):
        marker = ">>>" if expected.lower() in r["text"].lower() else "   "
        thresh = "ABOVE" if r["score"] >= min_score else "below"
        print(f"  {marker} [{i+1}] score={r['score']} ({thresh}) {r['path']}:{r['lines']}")
        print(f"       {r['text'][:120]}...")

    print(f"\n  FTS results (top {min(3, len(fts_results))}):")
    for i, r in enumerate(fts_results[:3]):
        marker = ">>>" if expected.lower() in r.get("text", "").lower() else "   "
        print(f"  {marker} [{i+1}] rank={r.get('fts_rank', '?')} {r.get('path', '?')}:{r.get('lines', '?')}")
        print(f"       {r.get('text', r.get('error', '?'))[:120]}...")

    print(f"\n  RESULT: {status}")
    print(f"  Top vector score: {top_score} (threshold: {min_score})")
    print(f"  Above threshold: {len(above_threshold)}/{len(vec_results)}")
    if status == "BELOW_THRESHOLD":
        match_score = next((r["score"] for r in vec_results if expected.lower() in r["text"].lower()), 0)
        print(f"  Expected answer found but score {match_score} < threshold {min_score}")

    return {
        "status": status,
        "query": query,
        "top_score": top_score,
        "above_threshold": len(above_threshold),
        "embed_ms": embed_ms,
    }


def main():
    min_score = float(sys.argv[1]) if len(sys.argv) > 1 else MIN_SCORE_DEFAULT

    print(f"Memory Search Test Harness")
    print(f"DB: {DB_PATH}")
    print(f"Scope: {SCOPE_PREFIX}")
    print(f"Min Score: {min_score}")
    print(f"Embedding: {EMBEDDING_MODEL}")
    print(f"Tests: {len(TEST_CASES)}")

    if not os.path.exists(DB_PATH):
        print(f"\nERROR: Database not found at {DB_PATH}")
        sys.exit(1)

    db = sqlite3.connect(DB_PATH)

    # Quick stats
    chunk_count = db.execute(
        "SELECT COUNT(*) FROM chunks WHERE path LIKE ?",
        (f"{SCOPE_PREFIX}/%",)
    ).fetchone()[0]
    file_count = db.execute(
        "SELECT COUNT(*) FROM files WHERE path LIKE ?",
        (f"{SCOPE_PREFIX}/%",)
    ).fetchone()[0]
    print(f"Indexed: {file_count} files, {chunk_count} chunks in scope")

    results = []
    for query, expected, desc in TEST_CASES:
        result = run_test(db, query, expected, desc, min_score)
        results.append(result)
        time.sleep(0.2)  # Rate limit embeddings

    # Summary
    print(f"\n{'='*70}")
    print(f"SUMMARY")
    print(f"{'='*70}")
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    below = sum(1 for r in results if r["status"] == "BELOW_THRESHOLD")
    skipped = sum(1 for r in results if r["status"] == "skip")

    print(f"  PASS: {passed}/{len(results)}")
    print(f"  FAIL: {failed}/{len(results)}")
    print(f"  BELOW_THRESHOLD: {below}/{len(results)} (found but score < {min_score})")
    if skipped:
        print(f"  SKIP: {skipped}/{len(results)}")

    if below > 0:
        print(f"\n  Recommendation: Lower minScore to capture more matches.")
        scores = [r["top_score"] for r in results if r["status"] == "BELOW_THRESHOLD"]
        if scores:
            print(f"  Lowest matching score: {min(scores)}")
            print(f"  Suggested threshold: {max(0.15, min(scores) - 0.05):.2f}")

    print(f"\n  Score distribution:")
    for r in sorted(results, key=lambda x: x.get("top_score", 0)):
        flag = {"PASS": "+", "FAIL": "X", "BELOW_THRESHOLD": "~", "skip": "?"}[r["status"]]
        score = r.get("top_score", 0)
        bar = "#" * int(score * 40) if score else ""
        print(f"  [{flag}] {score:.3f} {bar} {r['query'][:50]}")

    db.close()
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
