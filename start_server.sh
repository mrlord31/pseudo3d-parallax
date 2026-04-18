#!/usr/bin/env bash
set -e
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | grep VITE_HF_TOKEN | sed 's/VITE_//' | xargs)
fi
echo "Starting pseudo3d-parallax V2 server on http://localhost:8000"
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
