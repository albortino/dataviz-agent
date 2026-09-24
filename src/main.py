from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Any
import pandas as pd
import os
import requests
import re

try:
    from src.agent import ReActAgent
    from src.agent_skills import list_skills
    from src.tools import execute_python_code
except ImportError:
    from agent import ReActAgent
    try:
        from agent_skills import list_skills
    except ImportError:
        def list_skills():
            return []
    try:
        from tools import execute_python_code
    except ImportError:
        execute_python_code = None

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
DEFAULT_MODEL_NAME = os.getenv("LLM_MODEL", "deepseek-flash")
DEFAULT_API_KEY = os.getenv("LLM_API_KEY") or ""
DEFAULT_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", os.getenv("LLM_API_VERSION", "2024-10-21"))

class ChatRequest(BaseModel):
    message: Optional[str] = None
    data: Optional[List[Any]] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_version: Optional[str] = None
    active_skills: Optional[List[str]] = None
    row_count: Optional[int] = None
    dataset_profile: Optional[str] = None
    messages: Optional[List[dict]] = None
    tool_results: Optional[List[dict]] = None

class ValidateKeyRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_version: Optional[str] = None

class ExecuteCodeRequest(BaseModel):
    code: str
    data: List[Any]

def check_credentials_validity(api_key: str, base_url: str, model_name: str, api_version: str = None) -> dict:
    api_key = (api_key or "").strip()
    base_url = (base_url or "").rstrip("/")
    if base_url and not base_url.startswith("http://") and not base_url.startswith("https://"):
        base_url = f"https://{base_url}"
    is_local = "localhost" in base_url or "127.0.0.1" in base_url
    if not api_key and not is_local:
        return {
            "valid": False,
            "error": "No API Key configured. Please enter your API key in Settings.",
            "model": model_name
        }

    try:
        is_azure = "openai.azure.com" in base_url or "azure.com" in base_url
        if is_azure:
            clean_endpoint = re.sub(r"/openai(/.*)?$", "", base_url)
            ver = api_version or DEFAULT_API_VERSION or "2024-10-21"
            test_url = f"{clean_endpoint}/openai/deployments/{model_name}/chat/completions?api-version={ver}"
            headers = {"api-key": api_key, "Content-Type": "application/json"}
            payload = {"messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}
            resp = requests.post(test_url, headers=headers, json=payload, timeout=2.0)
        elif "anthropic.com" in base_url:
            test_url = f"{base_url}/messages" if base_url.endswith("/v1") else f"{base_url}/v1/messages"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json"
            }
            payload = {"model": model_name, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}
            resp = requests.post(test_url, headers=headers, json=payload, timeout=2.0)
        else:
            endpoint = base_url.rstrip("/")
            test_url = f"{endpoint}/chat/completions" if not endpoint.endswith("/chat/completions") else endpoint
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            payload = {"model": model_name, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}
            resp = requests.post(test_url, headers=headers, json=payload, timeout=2.0)

        if 200 <= resp.status_code < 300 or resp.status_code == 400:
            return {"valid": True, "model": model_name, "provider_url": base_url}
        elif resp.status_code == 401:
            return {
                "valid": False,
                "error": "Invalid API Key (401 Unauthorized).",
                "model": model_name
            }
        elif resp.status_code == 403:
            return {
                "valid": False,
                "error": "Access forbidden (403). Check permissions or VNet.",
                "model": model_name
            }
        elif resp.status_code == 404:
            return {
                "valid": False,
                "error": f"Deployment '{model_name}' not found (404).",
                "model": model_name
            }
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
            "error": "Timeout after 2s",
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
    user_api_version = (request.api_version or "").strip()

    # Fallback to server defaults if client key is empty and server key exists
    api_key = user_key or DEFAULT_API_KEY
    base_url = user_base_url or DEFAULT_BASE_URL
    model_name = user_model or DEFAULT_MODEL_NAME
    api_version = user_api_version or DEFAULT_API_VERSION

    res = check_credentials_validity(api_key, base_url, model_name, api_version)
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
        "id": "azure-openai",
        "name": "Azure OpenAI",
        "model": "gpt-4o",
        "base_url": "https://<your-resource>.openai.azure.com",
        "api_version": "2024-10-21"
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
    if not request.data and not request.messages:
        raise HTTPException(400, "No data or messages provided")
    
    api_key = (request.api_key or "").strip() or DEFAULT_API_KEY
    base_url = (request.base_url or "").strip() or DEFAULT_BASE_URL
    model_name = (request.model or "").strip() or DEFAULT_MODEL_NAME
    api_version = (request.api_version or "").strip() or DEFAULT_API_VERSION

    if not api_key and "localhost" not in base_url and "127.0.0.1" not in base_url:
        raise HTTPException(
            status_code=400,
            detail="No API Key provided. Please configure your API key in Settings or server environment variables."
        )

    try:
        df = pd.DataFrame(request.data) if request.data else pd.DataFrame()
        agent = ReActAgent(
            df=df,
            api_key=api_key,
            base_url=base_url,
            model_name=model_name,
            api_version=api_version,
            active_skills=request.active_skills,
            row_count=request.row_count,
            dataset_profile=request.dataset_profile,
        )
        result = agent.process_query(
            user_query=request.message,
            messages=request.messages,
            tool_results=request.tool_results
        )
        return result
    except Exception as e:
        raise HTTPException(500, f"Agent error: {str(e)}")

@app.post("/execute_code")
def execute_code_endpoint(request: ExecuteCodeRequest):
    """Direct fast-path endpoint to execute Python code against active data."""
    if not request.data:
        raise HTTPException(400, "No data provided")
    if not request.code or not request.code.strip():
        raise HTTPException(400, "No code provided")
    if execute_python_code is None:
        raise HTTPException(500, "Code execution engine is unavailable.")
    try:
        df = pd.DataFrame(request.data)
        result = execute_python_code(df, request.code)
        return result
    except Exception as e:
        raise HTTPException(500, f"Execution failed: {str(e)}")

@app.get("/agent_skills")
def agent_skills():
    """Manifest of runtime agent skills for the frontend toggle UI."""
    return {"skills": list_skills()}

@app.get("/readme")
def get_readme():
    try:
        with open("README.md", "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        raise HTTPException(500, f"Error reading README.md: {str(e)}")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

@app.get("/imprint")
def get_imprint():
    imprint_path = os.path.join(BASE_DIR, "IMPRINT.md")
    if os.path.exists(imprint_path):
        try:
            with open(imprint_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                return {"available": True, "content": content}
        except Exception:
            pass
    return {"available": False, "content": ""}

@app.get("/privacy")
def get_privacy():
    privacy_path = os.path.join(BASE_DIR, "PRIVACY.md")
    if os.path.exists(privacy_path):
        try:
            with open(privacy_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                return {"available": True, "content": content}
        except Exception:
            pass
    return {"available": False, "content": ""}

# Mount the static site at the root
app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")

@app.get("/")
def root():
    from fastapi.responses import FileResponse
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    from fastapi.responses import FileResponse
    return FileResponse(os.path.join(STATIC_DIR, "favicon.ico"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

