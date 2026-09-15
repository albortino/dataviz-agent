# Self-Hosting Guide for Dataviz-Agent

This guide provides step-by-step instructions for hosting **Dataviz-Agent** on your own infrastructure—ranging from a home server or Raspberry Pi to a cloud Virtual Private Server (VPS).

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Quick Docker Run](#quick-docker-run)
3. [Docker Compose Configurations](#docker-compose-configurations)
   - [Option A: Cloud LLM Setup (OpenAI / DeepSeek / Gemini / Claude)](#option-a-cloud-llm-setup)
   - [Option B: 100% Local Offline Setup with Ollama](#option-b-100-local-offline-setup-with-ollama)
4. [Environment Variables Reference](#environment-variables-reference)
5. [Self-Hosting Tips & Security Hardening](#self-hosting-tips--security-hardening)

---

## System Requirements

Dataviz-Agent is designed to be lightweight. The frontend runs visual computations entirely in the browser, while the backend handles agent queries and Python computations.

| Resource | Minimum | Recommended |
| :--- | :--- | :--- |
| **CPU** | 1 Core (x86_64 or ARM64 / Raspberry Pi 4 or 5) | 2+ Cores |
| **RAM** | 512 MB (when using cloud LLMs or BYOK) | 1 GB+ (Dataviz-Agent) / 16 GB+ (if running Ollama on same host) |
| **Disk** | 500 MB free space | 2 GB free space |
| **OS** | Linux (Ubuntu, Debian, Alpine, Fedora, Arch), macOS, or Windows (WSL2) | Ubuntu 22.04+ / Debian 12+ / Raspberry Pi OS 64-bit |

---

## Quick Docker Run

Run the container directly with Docker CLI:

```bash
docker run -d \
  --name dataviz-agent \
  --restart unless-stopped \
  --memory=512m \
  --pids-limit=50 \
  -p 8000:8000 \
  -e ALLOWED_ORIGINS="https://dataviz.mooo.com,http://localhost:8000" \
  -e LLM_API_KEY="your-api-key-here" \
  -e LLM_BASE_URL="https://api.deepseek.com" \
  -e LLM_MODEL="deepseek-flash" \
  dataviz-agent
```

---

## Docker Compose Configurations

### Option A: Cloud LLM Setup

Create a `docker-compose.yml` file on your server:

```yaml
version: '3.8'

services:
  dataviz-agent:
    build: .
    image: dataviz-agent:latest
    container_name: dataviz-agent
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          pids: 50
    ports:
      - "8000:8000"
    environment:
      - HOST=0.0.0.0
      - PORT=8000
      - ALLOWED_ORIGINS=https://dataviz.mooo.com,http://localhost:8000,http://127.0.0.1:8000
      - LLM_API_KEY=your-api-key-here
      - LLM_BASE_URL=https://api.deepseek.com
      - LLM_MODEL=deepseek-flash
```

Start the service:
```bash
docker compose up -d
```

---

### Option B: 100% Local Offline Setup with Ollama

When running [Ollama](https://ollama.com/) on the host machine, use `extra_hosts` to allow the Docker container to communicate directly with your host's Ollama instance without external internet egress:

```yaml
version: '3.8'

services:
  dataviz-agent:
    build: .
    image: dataviz-agent:latest
    container_name: dataviz-agent
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    deploy:
      resources:
        limits:
          memory: 512M
          pids: 50
    ports:
      - "8000:8000"
    environment:
      - HOST=0.0.0.0
      - PORT=8000
      - ALLOWED_ORIGINS=http://localhost:8000,http://127.0.0.1:8000
      - LLM_BASE_URL=http://host.docker.internal:11434/v1
      - LLM_MODEL=llama3.2
      # Leave LLM_API_KEY empty for Ollama
      - LLM_API_KEY=
```

> [!TIP]
> Ensure your local Ollama daemon is listening on all interfaces or accepting requests from Docker (e.g., `OLLAMA_HOST=0.0.0.0:11434`).

---

## Environment Variables Reference

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `ALLOWED_ORIGINS` | String | `https://dataviz.mooo.com,http://localhost:8000,...` | Comma-separated list of allowed CORS origins. |
| `LLM_API_KEY` | String | *(empty)* | Default server-side API key for the AI Agent. Also checks `DEEPSEEK_API_KEY` or `OPENAI_API_KEY`. |
| `LLM_BASE_URL` | String | `https://api.deepseek.com` | OpenAI-compatible endpoint URL (e.g., `https://api.openai.com/v1`, `http://localhost:11434/v1`). |
| `LLM_MODEL` / `MODEL_NAME` | String | `deepseek-flash` | Default model identifier for agent chat requests. |
| `PORT` | Integer | `8000` | Port for the backend server to bind to. |
| `HOST` | String | `0.0.0.0` | Network interface address to bind to. |

---

## Self-Hosting Tips & Security Hardening

### 1. Bring Your Own Key (BYOK) vs Server Key

> [!NOTE]
> If `LLM_API_KEY` is omitted or left empty, Dataviz-Agent operates in **BYOK Mode**. Each user can input their own API key in the browser **AI Settings** (⚙️) dialog. Keys are stored solely in the user's browser `localStorage` and never saved permanently on the server.

### 2. Resource Constraints & Sandboxing

- The backend agent includes AST sandboxing and execution timeouts to prevent accidental infinite loops.
- Setting Docker memory limits (`--memory=512m`) and process limits (`--pids-limit=50`) guarantees smooth co-existence with other services on resource-constrained hosts like a Raspberry Pi.

### 3. Reverse Proxy & HTTPS

When placing Dataviz-Agent behind Nginx, Caddy, or Cloudflare Tunnels:
- Make sure to add your public domain (e.g. `https://dataviz.yourdomain.com`) to the `ALLOWED_ORIGINS` environment variable.
- Forward the `Host` and `X-Forwarded-For` headers to ensure accurate origin validation.