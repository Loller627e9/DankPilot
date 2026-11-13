#!/bin/bash
set -e
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "Node.js is required (v18+)."; exit 1; }

[ -d node_modules ] || { echo "Installing dependencies..."; npm install; }

if [ -z "$BOT_TOKEN" ] && [ ! -f config.json ]; then
    echo "No BOT_TOKEN env var and no config.json found."
    echo "Copy .env.example to .env, or create config.json."
    exit 1
fi

echo "Starting Dank Farm bot..."
node index.js