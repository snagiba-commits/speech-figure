#!/bin/bash
# macOS: double-click to start the app and open it in Chrome.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org and run this again."; read -n 1; exit 1
fi
if [ ! -d public/vendor ]; then echo "First run: installing dependencies..."; npm install && npm run setup || { read -n 1; exit 1; }; fi
(sleep 1; open -a "Google Chrome" "http://localhost:5173" 2>/dev/null || open "http://localhost:5173") &
node server.mjs
