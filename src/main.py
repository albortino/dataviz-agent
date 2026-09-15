from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Any
import pandas as pd
import os
import requests

try:
    from src.agent import ReActAgent
except ImportError:
    from agent import ReActAgent

app = FastAPI()

ALLOWED_ORIGINS_ENV = os.getenv(
    "ALLOWED_ORIGINS",
    "https://dataviz.mooo.com,http://localhost:8000,http://127.0.0.1:8000,http://localhost:8100,http://127.0.0.1:8100"
)
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS_ENV.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

DEFAULT_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
DEFAULT_MODEL_NAME = os.getenv("MODEL_NAME", os.getenv("LLM_MODEL", "deepseek-flash"))
DEFAULT_API_KEY = os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY") or ""

class ChatRequest(BaseModel):
    message: str
    data: List[Any]
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None

class ValidateKeyRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None

def check_credentials_validity(api_key: str, base_url: str, model_name: str) -> dict:
    api_key = (api_key or "").strip()
    base_url = (base_url or "").rstrip("/")
    is_local = "localhost" in base_url or "127.0.0.1" in base_url
    if not api_key and not is_local:
        return {
            "valid": False,
            "error": "No API Key configured. Please enter your API key in Settings.",
            "model": model_name
        }

    try:
        if "anthropic.com" in base_url:
            test_url = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01"
            }
            resp = requests.get(test_url, headers=headers, timeout=6)
        else:
            test_url = f"{base_url}/models"
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            resp = requests.get(test_url, headers=headers, timeout=6)

        if resp.status_code == 200:
            return {"valid": True, "model": model_name, "provider_url": base_url}
        elif resp.status_code == 401:
            return {
                "valid": False,
                "error": "Invalid API Key (401 Unauthorized). Please check your key in Settings.",
                "model": model_name
            }
        elif resp.status_code == 403:
            return {
                "valid": False,
                "error": "Access forbidden (403). Your API key may lack permissions for this provider/model.",
                "model": model_name
            }
        elif resp.status_code == 404:
            # Endpoint reached but /models path not implemented by proxy
            return {"valid": True, "model": model_name, "provider_url": base_url}
        else:
            err_text = resp.text[:120] if resp.text else f"Status code {resp.status_code}"
            return {
                "valid": False,
                "error": f"API Provider Error ({resp.status_code}): {err_text}",
                "model": model_name
            }
    except requests.exceptions.Timeout:
        return {
            "valid": False,
            "error": f"Connection timed out reaching {base_url}. Please check your network or provider URL.",
            "model": model_name
        }
    except requests.exceptions.ConnectionError:
        return {
            "valid": False,
            "error": f"Cannot reach provider at {base_url}. Please ensure URL is correct.",
            "model": model_name
        }
    except Exception as e:
        return {"valid": False, "error": f"Validation failed: {str(e)}", "model": model_name}


@app.get("/health")
def health():
    server_status = check_credentials_validity(DEFAULT_API_KEY, DEFAULT_BASE_URL, DEFAULT_MODEL_NAME) if (DEFAULT_API_KEY or "localhost" in DEFAULT_BASE_URL or "127.0.0.1" in DEFAULT_BASE_URL) else {"valid": False}
    return {
        "status": "healthy",
        "provider_url": DEFAULT_BASE_URL,
        "default_model": DEFAULT_MODEL_NAME,
        "has_server_key": bool(DEFAULT_API_KEY),
        "server_settings_valid": server_status.get("valid", False)
    }

@app.post("/validate_key")
def validate_key(request: ValidateKeyRequest):
    """Validates the LLM API key with zero token usage via provider model endpoint."""
    user_key = (request.api_key or "").strip()
    user_base_url = (request.base_url or "").strip()
    user_model = (request.model or "").strip()

    # Fallback to server defaults if client key is empty and server key exists
    api_key = user_key or DEFAULT_API_KEY
    base_url = user_base_url or DEFAULT_BASE_URL
    model_name = user_model or DEFAULT_MODEL_NAME

    res = check_credentials_validity(api_key, base_url, model_name)
    res["uses_server_key"] = bool(not user_key and DEFAULT_API_KEY)
    return res

PROVIDER_PRESETS = [
    {
        "id": "deepseek-flash",
        "name": "DeepSeek Flash",
        "model": "deepseek-flash",
        "base_url": "https://api.deepseek.com",
        "default": True
    },
    {
        "id": "openai-gpt56-terra",
        "name": "OpenAI GPT-5.6 Terra",
        "model": "gpt-5.6-terra",
        "base_url": "https://api.openai.com/v1"
    },
    {
        "id": "gemini-flash",
        "name": "Google Gemini Flash",
        "model": "gemini-3.8-flash",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/"
    },
    {
        "id": "anthropic-sonnet",
        "name": "Anthropic Claude Sonnet",
        "model": "claude-sonnet-5",
        "base_url": "https://api.anthropic.com/v1"
    },
    {
        "id": "ollama-local",
        "name": "Ollama Local",
        "model": "",
        "base_url": "http://localhost:11434/v1"
    },
    {
        "id": "openrouter",
        "name": "OpenRouter Gateway",
        "model": "openrouter/auto",
        "base_url": "https://openrouter.ai/api/v1"
    }
]

@app.get("/models")
def models():
    """Returns provider info, recommended presets, and server-configured default status."""
    server_status = check_credentials_validity(DEFAULT_API_KEY, DEFAULT_BASE_URL, DEFAULT_MODEL_NAME) if (DEFAULT_API_KEY or "localhost" in DEFAULT_BASE_URL or "127.0.0.1" in DEFAULT_BASE_URL) else {"valid": False}
    return {
        "default_model": DEFAULT_MODEL_NAME,
        "default_base_url": DEFAULT_BASE_URL,
        "has_server_key": bool(DEFAULT_API_KEY),
        "server_settings_valid": server_status.get("valid", False),
        "presets": PROVIDER_PRESETS
    }

@app.post("/chat")
def chat(request: ChatRequest):
    if not request.data:
        raise HTTPException(400, "No data provided")
    
    api_key = (request.api_key or "").strip() or DEFAULT_API_KEY
    base_url = (request.base_url or "").strip() or DEFAULT_BASE_URL
    model_name = (request.model or "").strip() or DEFAULT_MODEL_NAME

    if not api_key and "localhost" not in base_url and "127.0.0.1" not in base_url:
        raise HTTPException(
            status_code=400,
            detail="No API Key provided. Please configure your API key in Settings or server environment variables."
        )

    try:
        df = pd.DataFrame(request.data)
        agent = ReActAgent(
            df=df,
            api_key=api_key,
            base_url=base_url,
            model_name=model_name
        )
        result = agent.process_query(request.message)
        return result
    except Exception as e:
        raise HTTPException(500, f"Agent error: {str(e)}")

@app.get("/readme")
def get_readme():
    try:
        with open("README.md", "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        raise HTTPException(500, f"Error reading README.md: {str(e)}")

@app.get("/imprint")
def get_imprint():
    if os.path.exists("IMPRINT.md"):
        try:
            with open("IMPRINT.md", "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                return {"available": True, "content": content}
        except Exception:
            pass
    return {"available": False, "content": ""}

@app.get("/privacy")
def get_privacy():
    if os.path.exists("PRIVACY.md"):
        try:
            with open("PRIVACY.md", "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                return {"available": True, "content": content}
        except Exception:
            pass
    return {"available": False, "content": ""}

# Mount the static site at the root
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

@app.get("/")
def root():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    from fastapi.responses import FileResponse
    return FileResponse("static/favicon.ico")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

