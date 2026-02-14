#!/bin/bash
# ClawRouter Setup Script for Clawdbot
# Run this after cloning the repo to set up FreeRouter

set -e

echo "🚀 ClawRouter Setup Script"
echo "=========================="

# Check prerequisites
echo ""
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi
echo "✅ Node.js: $(node --version)"

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm first."
    exit 1
fi
echo "✅ npm: $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Build
echo ""
echo "🔨 Building..."
npm run build

# Check for OAuth token
echo ""
echo "🔑 Checking authentication..."

if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    TOKEN_PREFIX=$(echo "$CLAUDE_CODE_OAUTH_TOKEN" | head -c 12)
    echo "✅ OAuth token found: ${TOKEN_PREFIX}..."
elif [ -n "$ANTHROPIC_API_KEY" ]; then
    TOKEN_PREFIX=$(echo "$ANTHROPIC_API_KEY" | head -c 12)
    echo "✅ API key found: ${TOKEN_PREFIX}..."
else
    echo "⚠️  No auth token found!"
    echo ""
    echo "To get an OAuth token (recommended):"
    echo "  1. Run: claude login"
    echo "  2. Complete browser authentication"
    echo "  3. Run: security find-generic-password -s \"Claude Safe Storage\" -w"
    echo "  4. Add to ~/.zshrc:"
    echo "     export CLAUDE_CODE_OAUTH_TOKEN=\"sk-ant-oat01-...\""
    echo "  5. Run: source ~/.zshrc"
    echo ""
fi

# Check Clawdbot config
echo ""
echo "📝 Checking Clawdbot configuration..."

CLAWDBOT_CONFIG="$HOME/.clawdbot/clawdbot.json"
if [ -f "$CLAWDBOT_CONFIG" ]; then
    if grep -q "freerouter" "$CLAWDBOT_CONFIG"; then
        echo "✅ FreeRouter already configured in Clawdbot"
    else
        echo "⚠️  FreeRouter not found in Clawdbot config"
        echo ""
        echo "Add this to $CLAWDBOT_CONFIG under 'models.providers':"
        echo '  "freerouter": {'
        echo '    "baseUrl": "http://127.0.0.1:18800",'
        echo '    "apiKey": "freerouter-local",'
        echo '    "api": "openai-completions",'
        echo '    "models": [{"id": "auto", "name": "Smart Router"}]'
        echo '  }'
        echo ""
        echo "And set default model under 'agents.defaults.model':"
        echo '  "primary": "freerouter/auto"'
    fi
else
    echo "⚠️  Clawdbot config not found at $CLAWDBOT_CONFIG"
fi

echo ""
echo "=========================="
echo "✅ Setup complete!"
echo ""
echo "To start FreeRouter:"
echo "  source ~/.zshrc"
echo "  node dist/server.js"
echo ""
echo "To verify:"
echo "  curl http://127.0.0.1:18800/health"
echo ""
