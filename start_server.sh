#!/usr/bin/env bash
set -e

# Load HF token from .env.local
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | grep VITE_HF_TOKEN | sed 's/VITE_//' | xargs)
fi

# Create venv if it doesn't exist
if [ ! -d .venv ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

# Activate venv
source .venv/bin/activate

# Install deps if uvicorn is missing
if ! .venv/bin/python -m uvicorn --version &>/dev/null; then
  echo "Installing Python dependencies..."
  pip install -r requirements.txt
fi

echo "Starting pseudo3d-parallax V2 server on http://localhost:8000"
python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
