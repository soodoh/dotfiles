# LiteLLM Proxy for Claude Code

A Docker Compose setup for running [LiteLLM](https://github.com/BerriAI/litellm), providing unified access to GitHub Copilot and other LLM providers through an OpenAI-compatible API.

## Setup

1. **Environment file:**
   - A `.env` file is already included with:
     - Generated master key for API access
     - Default UI credentials (username: `admin`, password: `admin123`)
   - **Recommended:** Change `LITELLM_UI_PASSWORD` in `.env` for better security

2. **Corporate Proxy SSL (if needed):**
   If behind a corporate proxy with custom SSL certificates:
   ```bash
   # Create combined CA bundle (macOS example with Netskope)
   cat /opt/homebrew/etc/openssl@3/cert.pem ~/netskope-root.pem > ca-bundle.pem

   # Create docker-compose.override.yml
   cat > docker-compose.override.yml <<EOF
   services:
     litellm:
       environment:
         - SSL_CERT_FILE=/app/ca-bundle.pem
       volumes:
         - ./ca-bundle.pem:/app/ca-bundle.pem:ro
   EOF
   ```
   These files are gitignored and machine-specific.

3. **Start the service:**
   ```bash
   docker-compose up -d
   ```

4. **Authenticate with GitHub Copilot (first time only):**
   ```bash
   docker-compose logs -f litellm
   ```
   Watch for the OAuth device flow prompt. You'll see a URL and code to authenticate with GitHub.

5. **Verify it's running:**
   ```bash
   curl http://localhost:1337/health
   ```

## Claude Code Integration

Configure Claude Code to use the LiteLLM proxy:

```bash
export ANTHROPIC_BASE_URL="http://localhost:1337"
export ANTHROPIC_AUTH_TOKEN="sk-KsM7b170we3gBSk2jiOx0xHU0Hx60_Rfphn708P9n7M"
```

Or add to your shell config (`~/.zshrc` or `~/.bashrc`):
```bash
# LiteLLM Proxy
export ANTHROPIC_BASE_URL="http://localhost:1337"
export ANTHROPIC_AUTH_TOKEN="sk-KsM7b170we3gBSk2jiOx0xHU0Hx60_Rfphn708P9n7M"
```

Then use any available model:
```bash
# Claude models
claude --model claude-opus-4-5
claude --model claude-sonnet-4-5
claude --model claude-haiku-4-5

# GPT models
claude --model gpt-5-2
claude --model gpt-5-2-codex
```

## Available Models

Models provided through GitHub Copilot and other configured providers:

### Claude Models
| Model Name          | Description              |
|---------------------|--------------------------|
| claude-opus-4-5     | Claude Opus 4.5          |
| claude-sonnet-4-5   | Claude Sonnet 4.5        |
| claude-haiku-4-5    | Claude Haiku 4.5         |
| claude-3-5-sonnet   | Claude 3.5 Sonnet        |

### GPT Models
| Model Name          | Description              |
|---------------------|--------------------------|
| gpt-5-2             | GPT 5.2                  |
| gpt-5-2-codex       | GPT 5.2 Codex            |

List available models:
```bash
curl http://localhost:1337/v1/models
```

## Management

- **Web UI:** http://localhost:1337 (credentials in `.env`)
- **Health check:** http://localhost:1337/health
- **Logs:** `docker-compose logs -f litellm`

## Management Commands

```bash
# Start in background
docker-compose up -d

# View logs (watch for OAuth prompts on first run)
docker-compose logs -f litellm

# Stop
docker-compose down

# Restart
docker-compose restart

# Update to latest image
docker-compose pull && docker-compose up -d

# Re-authenticate (if tokens expire or you need to switch accounts)
docker volume rm copilot-api_github_copilot_tokens
docker-compose restart
```

## Adding More Providers

Edit `litellm_config.yaml` to add OpenAI, Anthropic, or other providers. Add corresponding API keys to `.env`.

Example for adding direct OpenAI access:
```yaml
- model_name: gpt-4-turbo
  litellm_params:
    model: openai/gpt-4-turbo
    api_key: os.environ/OPENAI_API_KEY
```

## Authentication

**GitHub Copilot uses OAuth device flow authentication:**

1. On first use, when you make a request to a GitHub Copilot model, LiteLLM will prompt you to authenticate
2. Check the logs: `docker-compose logs -f litellm`
3. You'll see a device code and verification URL (like https://github.com/login/device)
4. Open the URL in your browser and enter the code
5. Authenticate with your GitHub account that has Copilot access
6. Credentials are stored in the `github_copilot_tokens` volume and persist across restarts

**No GitHub App setup or API keys needed!** Just your regular GitHub account with Copilot subscription.

## Troubleshooting

- Ensure GitHub Copilot is enabled for your account
- Check logs: `docker-compose logs litellm`
- Verify environment variables are set correctly
- SQLite database and logs are stored in the `litellm_data` volume

## Requirements

- GitHub account with Copilot subscription (individual or organization)
- Docker and Docker Compose

That's it! No GitHub App setup needed.
