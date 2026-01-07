# Running claude code with GitHub Copilot provider

## Prerequisites

* Node, npm, yarn is installed
* Claude code is installed

## Getting Started

### Start copilot-api in separate terminal tab

This is needed to run in order to proxy OpenAPI-style API requests to the GitHub Copilot provider.
Ensure you choose a non-conflicting port with your other local development.

```sh
yarn dlx copilot-api@latest start -p 1337
```

Go to `github.com/login/device` and copy the code shown after running the above command.

### Ensure ~/.claude/settings.json points to this proxy

Update your `~/.claude/settings.json` file to the following:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:1337",
    "ANTHROPIC_AUTH_TOKEN": "sk-dummy",
    "ANTHROPIC_MODEL": "claude-sonnet-4.5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5-mini",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

### Run claude

For the first time, you may have to run the following:
```sh
export ANTHROPIC_BASE_URL="http://localhost:1337"
export ANTHROPIC_AUTH_TOKEN="sk-dummy"
export ANTHROPIC_MODEL="claude-sonnet-4.5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="gpt-5-mini"
export DISABLE_NON_ESSENTIAL_MODEL_CALLS="1"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"

claude
```

Otherwise, just run `claude` and enjoy!

## Extras

### View usage

Navigate to: `https://ericc-ch.github.io/copilot-api/?endpoint=http%3A%2F%2Flocalhost%3A1337%2Fusage`
