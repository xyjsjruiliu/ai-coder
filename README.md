# AI Coder

> Terminal AI coding assistant — multi-provider, streaming TUI, tool-capable.

## Quick Start

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Or use Ollama (local)
# ollama pull deepseek-v4-pro:cloud

# Run
npx ai-coder "Explain Python's asyncio"

# Interactive mode
npx ai-coder repl
```

## Providers

| Provider | Flag | Model Examples |
|----------|------|----------------|
| Anthropic | `--provider anthropic` | `claude-sonnet-4-20250514` |
| OpenAI | `--provider openai` | `gpt-4o` |
| OpenRouter | `--provider openrouter` | `anthropic/claude-sonnet-4` |
| Ollama | `--provider ollama` | `deepseek-v4-pro:cloud` |

## Commands

```bash
# One-shot query
ai-coder "Your question"

# Interactive TUI
ai-coder repl --provider ollama --model deepseek-v4-pro:cloud

# Print mode (non-interactive)
ai-coder "Your question" --print

# Continue previous session
ai-coder repl --continue

# Debug mode
ai-coder repl --debug
```

## TUI Controls

| Key | Action |
|-----|--------|
| `Enter` | Submit query |
| `Ctrl+C` (1×) | Abort current request |
| `Ctrl+C` (3×) | Force quit |
| `/exit` | Quit |
| `/model <id>` | Switch model |
| `/clear` | Clear history |

## Configuration

Create `~/.ai-coder/config.json`:

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-20250514",
  "maxTurns": 10
}
```

## Architecture

```
src/
├── llm/          Provider abstraction (Anthropic, OpenAI, OpenRouter, Ollama)
├── agent/        Agent loop (multi-turn, tool orchestration, error recovery)
├── ui/           Ink TUI (streaming output, status bar, input panel)
├── config/       Zod-validated config loader
└── cli.ts        Commander.js entry point
```

## License

MIT
