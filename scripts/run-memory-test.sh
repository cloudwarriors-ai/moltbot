#!/bin/bash
# Run memory search test harness inside the openclaw container
# Usage: ./scripts/run-memory-test.sh [min_score]
#   e.g. ./scripts/run-memory-test.sh 0.25

MIN_SCORE="${1:-0.35}"

docker cp scripts/test-memory-search.py openclaw:/tmp/test-memory-search.py
docker exec -e OPENAI_API_KEY="$OPENAI_API_KEY" openclaw python3 /tmp/test-memory-search.py "$MIN_SCORE"
