# Copilot API Proxy

A Docker Compose setup for running [copilot-api](https://github.com/jjleng/copilot-api), providing access to GitHub Copilot's models through an OpenAI-compatible API.

## Quick Start

1. Start the proxy:
   ```bash
   docker compose up -d
   ```

2. Authenticate with GitHub (first time only):
   ```bash
   docker compose logs -f
   ```
   Follow the device flow instructions to authenticate with your GitHub account.

3. Verify it's running:
   ```bash
   curl http://localhost:4000/health
   ```

## Claude Code Integration

Configure Claude Code to use the Copilot API:

```bash
export ANTHROPIC_BASE_URL="http://localhost:4000"
export ANTHROPIC_AUTH_TOKEN="dummy"
claude --model claude-sonnet-4
```

Or add to your shell config:
```bash
# ~/.zshrc or ~/.bashrc
export ANTHROPIC_BASE_URL="http://localhost:4000"
export ANTHROPIC_AUTH_TOKEN="dummy"
```

Note: `ANTHROPIC_AUTH_TOKEN` is required by Claude Code but copilot-api doesn't validate it. Any non-empty value works.

## Available Models

All models provided by your GitHub Copilot subscription:

### Claude Models
| Model Name        | Description       |
|-------------------|-------------------|
| claude-3.5-sonnet | Claude 3.5 Sonnet |
| claude-3.7-sonnet | Claude 3.7 Sonnet |
| claude-sonnet-4   | Claude Sonnet 4   |

### GPT Models
| Model Name  | Description |
|-------------|-------------|
| gpt-4o      | GPT-4o      |
| gpt-4o-mini | GPT-4o Mini |
| gpt-4.1     | GPT-4.1     |

### OpenAI o-series
| Model Name | Description |
|------------|-------------|
| o1         | o1          |
| o1-mini    | o1 Mini     |
| o1-preview | o1 Preview  |
| o3-mini    | o3 Mini     |

### Google Models
| Model Name       | Description      |
|------------------|------------------|
| gemini-2.0-flash | Gemini 2.0 Flash |

List available models:
```bash
curl http://localhost:4000/v1/models
```

## Management Commands

```bash
# Start in background
docker compose up -d

# View logs (and authenticate if needed)
docker compose logs -f

# Stop
docker compose down

# Restart
docker compose restart

# Update to latest image
docker compose pull && docker compose up -d

# Re-authenticate (clear stored credentials)
rm -rf data && docker compose restart
```

## Authentication

The first time you start the container, check the logs for a GitHub device flow URL. Open it in your browser and enter the code shown to authenticate.

Credentials are stored in `./data/` and persist across restarts.

## Requirements

- GitHub account with Copilot subscription (individual or organization)
- Docker and Docker Compose
