#!/bin/bash
# Start FreeRouter for Clawdbot
# Usage: ./scripts/start.sh [--foreground]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/tmp/freerouter.log"

cd "$PROJECT_DIR"

# Source zshrc to get OAuth token
if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc" 2>/dev/null || true
fi

# Check for auth
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠️  Warning: No auth token found"
    echo "   Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY"
fi

# Kill existing process
if pgrep -f "node dist/server.js" > /dev/null; then
    echo "Stopping existing FreeRouter..."
    pkill -f "node dist/server.js"
    sleep 1
fi

# Start
if [ "$1" = "--foreground" ] || [ "$1" = "-f" ]; then
    echo "Starting FreeRouter in foreground..."
    echo "Press Ctrl+C to stop"
    node dist/server.js
else
    echo "Starting FreeRouter in background..."
    nohup node dist/server.js > "$LOG_FILE" 2>&1 &
    sleep 2
    
    # Verify
    if curl -s http://127.0.0.1:18800/health > /dev/null 2>&1; then
        echo "✅ FreeRouter started successfully"
        echo "   Logs: $LOG_FILE"
        echo "   Health: http://127.0.0.1:18800/health"
        echo "   Stats: http://127.0.0.1:18800/stats"
    else
        echo "❌ FreeRouter failed to start"
        echo "   Check logs: tail -20 $LOG_FILE"
        exit 1
    fi
fi
