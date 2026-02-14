# ClawRouter - Smart AI Model Router for Clawdbot

Route AI requests to the right model automatically based on complexity. Simple queries → cheap models (Haiku), complex queries → powerful models (Opus).

**Saves 60-80% on API costs** by not using Opus for "Hello!"

## Quick Start (For AI Agents)

If you're a Clawdbot agent setting this up from scratch, follow these steps in order:

### Step 1: Clone the Repo

```bash
cd ~/clawd
git clone git@github.com:haianbui/ClawRouter.git freerouter
cd freerouter
npm install
npm run build
```

### Step 2: Get OAuth Token

```bash
# Install Claude Code CLI if not present
npm install -g @anthropic-ai/claude-code

# Login (opens browser)
claude login

# After login, get the token
security find-generic-password -s "Claude Safe Storage" -w
# Should return: sk-ant-oat01-...
```

### Step 3: Configure Environment

Add to `~/.zshrc`:
```bash
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-YOUR_TOKEN_HERE"
```

Then reload:
```bash
source ~/.zshrc
```

### Step 4: Configure Clawdbot

Add FreeRouter as a provider in `~/.clawdbot/clawdbot.json`:

```json
{
  "models": {
    "providers": {
      "freerouter": {
        "baseUrl": "http://127.0.0.1:18800",
        "apiKey": "freerouter-local",
        "api": "openai-completions",
        "models": [
          {
            "id": "auto",
            "name": "Smart Router",
            "contextWindow": 200000,
            "maxTokens": 8192,
            "reasoning": false
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "freerouter/auto"
      }
    }
  }
}
```

### Step 5: Start FreeRouter

```bash
cd ~/clawd/freerouter
source ~/.zshrc  # Load OAuth token
node dist/server.js > /tmp/freerouter.log 2>&1 &
```

### Step 6: Verify

```bash
# Health check
curl http://127.0.0.1:18800/health
# Expected: {"status":"ok",...}

# Test routing
curl -s http://127.0.0.1:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hi"}],"max_tokens":50}'
# Should return a response from Haiku

# Check stats
curl http://127.0.0.1:18800/stats
# Should show: "SIMPLE": 1, model: "claude-3-haiku-20240307"
```

### Step 7: Restart Clawdbot Gateway

```bash
clawdbot gateway restart
```

---

## How It Works

```
User → Clawdbot → FreeRouter (:18800) → Classifier → Route to:
                                        ├── SIMPLE → Haiku (cheap, fast)
                                        ├── MEDIUM → Sonnet (balanced)
                                        ├── COMPLEX → Opus (powerful)
                                        └── REASONING → Opus (max thinking)
```

### Tier Classification

| Tier | Examples | Model |
|------|----------|-------|
| SIMPLE | "Hi", "Thanks", "What's the weather?" | Haiku |
| MEDIUM | "Write a function", "Debug this code" | Sonnet |
| COMPLEX | "Design a microservice architecture" | Opus |
| REASONING | "Prove this theorem step by step" | Opus |

### Quick Pattern Matching

FreeRouter uses fast regex patterns for instant classification:
- Greetings → SIMPLE
- Short messages (≤20 chars) → SIMPLE
- Code requests → MEDIUM
- Architecture terms → COMPLEX
- Math/proof keywords → REASONING

---

## Authentication

### OAuth Token (Recommended)

Uses Claude Code OAuth token, tied to your Claude Pro subscription:

```bash
# Get new token
claude login

# Token location: macOS Keychain "Claude Safe Storage"
# Token format: sk-ant-oat01-...

# Set in environment
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
```

### API Key (Alternative)

Direct Anthropic API billing (pay-per-token):

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

---

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + uptime |
| `/stats` | GET | Request counts by tier/model |
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/models` | GET | List available models |
| `/reload` | POST | Reload auth keys |

---

## Troubleshooting

### "No Anthropic auth token" Error

```bash
# Check if token is set
echo $CLAUDE_CODE_OAUTH_TOKEN

# If empty, re-login
claude login

# Then restart FreeRouter
pkill -f "node dist/server"
cd ~/clawd/freerouter && source ~/.zshrc && node dist/server.js &
```

### All Requests Going to One Tier

Check the logs:
```bash
tail -20 /tmp/freerouter.log
```

Look for classification output like:
```
[INFO] Classified: tier=SIMPLE confidence=0.95 | quick-match: SIMPLE
```

### FreeRouter Not Starting

```bash
# Check if port is in use
lsof -i :18800

# Kill existing process
pkill -f "node dist/server"

# Start fresh
cd ~/clawd/freerouter
npm run build
node dist/server.js
```

### OAuth Token Expired

```bash
# Re-authenticate
claude login

# Get new token and update ~/.zshrc
security find-generic-password -s "Claude Safe Storage" -w
```

---

## File Structure

```
freerouter/
├── src/
│   ├── auth.ts          # OAuth/API key loading
│   ├── provider.ts      # Anthropic API forwarding
│   ├── server.ts        # HTTP server
│   └── router/
│       ├── rules.ts     # Quick pattern matching
│       ├── config.ts    # Tier boundaries & models
│       └── index.ts     # Classification logic
├── dist/                # Compiled JS
└── package.json
```

---

## Key Improvements

This fork includes several improvements over the original FreeRouter:

1. **User-message-only classification** - Ignores system prompt size
2. **Quick pattern matching** - Instant tier assignment for common queries
3. **Expanded tier boundaries** - SIMPLE tier now reachable (0.25 threshold)
4. **OAuth token support** - Uses Claude Pro subscription
5. **Clawdbot integration** - Reads auth from environment

---

## Cost Impact

| Scenario | Estimated Cost |
|----------|----------------|
| All Opus | ~$50/day |
| With FreeRouter | ~$10-15/day |
| **Savings** | **60-80%** |

With OAuth token, costs are covered by your Claude Pro subscription.

---

## License

MIT - Forked from [openfreerouter/freerouter](https://github.com/openfreerouter/freerouter)

Original classifier from [BlockRunAI/ClawRouter](https://github.com/BlockRunAI/ClawRouter)
