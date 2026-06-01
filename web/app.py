import hashlib
import os
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from web import env_store, security, systemd


BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


def preload_env(override: bool = False) -> None:
    for key, value in env_store.read_values().items():
        if override:
            os.environ[key] = value
        else:
            os.environ.setdefault(key, value)


def session_secret() -> str:
    configured = os.environ.get("ADMIN_SESSION_SECRET", "").strip()
    if configured:
        return configured
    password_hash = os.environ.get("ADMIN_PASSWORD_HASH", "").strip()
    if password_hash:
        return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()
    return hashlib.sha256(os.urandom(32)).hexdigest()


preload_env()
app = FastAPI(title="community-keeper Web")
app.add_middleware(
    SessionMiddleware,
    secret_key=session_secret(),
    same_site="lax",
    https_only=os.environ.get("ADMIN_COOKIE_SECURE", "true").lower()
    in {"1", "true", "yes", "on"},
)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(path, status_code=303)


def require_login(request: Request):
    if not security.is_authenticated(request):
        return redirect("/login")
    return None


def flash(request: Request, message: str, category: str = "info") -> None:
    request.session["flash"] = {"message": message, "category": category}


def pop_flash(request: Request) -> Dict[str, str]:
    return request.session.pop("flash", {})


def template_context(request: Request, **kwargs):
    context = {
        "request": request,
        "username": request.session.get("username"),
        "flash": pop_flash(request),
        "env_file": str(env_store.env_file_path()),
    }
    context.update(kwargs)
    return context


def indexed_nodeseek_fields(values: Dict[str, str]) -> List[env_store.EnvField]:
    fields: List[env_store.EnvField] = []
    for key in sorted(values):
        if not key.startswith("NODESEEK_COOKIE_") or not key.rsplit("_", 1)[-1].isdigit():
            continue
        if key in env_store.FIELD_MAP:
            continue
        fields.append(
            env_store.EnvField(
                key=key,
                label=key,
                group="NodeSeek 多账号",
                secret=any(part in key for part in ["COOKIE", "PASSWORD", "TOKEN"]),
                textarea="COOKIE" in key,
            )
        )
    return fields


def grouped_fields(values: Dict[str, str]):
    groups = []
    for group in env_store.FIELD_GROUPS:
        groups.append({"name": group["name"], "fields": group["fields"]})
    extra = indexed_nodeseek_fields(values)
    if extra:
        groups.insert(3, {"name": "NodeSeek 多账号", "fields": extra})
    return groups


def allowed_extra_key(key: str) -> bool:
    if not env_store.KEY_PATTERN.match(key):
        return False
    if key in env_store.FIELD_MAP:
        return True
    if "_" not in key or not key.rsplit("_", 1)[-1].isdigit():
        return False
    base_name = key.rsplit("_", 1)[0]
    return base_name == "NODESEEK_COOKIE"


def parse_extra_env(raw: str) -> Dict[str, str]:
    updates: Dict[str, str] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("export "):
            stripped = stripped[7:].strip()
        if "=" not in stripped:
            raise ValueError(f"Invalid extra env line: {line}")
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not allowed_extra_key(key):
            raise ValueError(f"Extra env key is not allowed: {key}")
        updates[key] = value
    return updates


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if security.is_authenticated(request):
        return redirect("/")
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context=template_context(
            request,
            auth_ready=bool(
                security.configured_password_hash()
                or security.configured_password()
            ),
        ),
    )


@app.post("/login")
async def login(request: Request, username: str = Form(...), password: str = Form(...)):
    if not security.configured_password_hash() and not security.configured_password():
        flash(request, "请先配置 ADMIN_PASSWORD_HASH 或 ADMIN_PASSWORD。", "error")
        return redirect("/login")

    if (
        username == security.configured_username()
        and security.verify_configured_password(password)
    ):
        security.login_session(request, username)
        return redirect("/")

    flash(request, "用户名或密码不正确。", "error")
    return redirect("/login")


@app.post("/logout")
async def logout(request: Request):
    security.logout_session(request)
    return redirect("/login")


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    if response := require_login(request):
        return response
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context=template_context(
            request,
            service_status=systemd.service_status(),
            timer_status=systemd.timer_status(),
            next_runs=systemd.next_runs(),
        ),
    )


@app.get("/config", response_class=HTMLResponse)
async def config_page(request: Request):
    if response := require_login(request):
        return response
    values = env_store.read_values()
    return templates.TemplateResponse(
        request=request,
        name="config.html",
        context=template_context(
            request,
            groups=grouped_fields(values),
            values=values,
            mask_value=env_store.mask_value,
        ),
    )


@app.post("/config")
async def save_config(request: Request):
    if response := require_login(request):
        return response
    form = await request.form()
    current_values = env_store.read_values()
    updates: Dict[str, str] = {}

    for key, field in env_store.FIELD_MAP.items():
        if key not in form:
            continue
        value = str(form.get(key, "")).strip()
        if field.secret and value == "":
            continue
        updates[key] = value

    for field in indexed_nodeseek_fields(current_values):
        value = str(form.get(field.key, "")).strip()
        if field.secret and value == "":
            continue
        updates[field.key] = value

    try:
        updates.update(parse_extra_env(str(form.get("extra_env", ""))))
        env_store.write_values(updates)
    except ValueError as exc:
        flash(request, str(exc), "error")
        return redirect("/config")

    preload_env(override=True)
    flash(request, "配置已保存。", "success")
    return redirect("/config")


@app.get("/logs", response_class=HTMLResponse)
async def logs_page(request: Request, lines: int = 200):
    if response := require_login(request):
        return response
    return templates.TemplateResponse(
        request=request,
        name="logs.html",
        context=template_context(
            request,
            lines=max(20, min(lines, 1000)),
            logs=systemd.recent_logs(lines),
        ),
    )


@app.post("/actions/{action}")
async def run_action(request: Request, action: str):
    if response := require_login(request):
        return response
    actions = {
        "start": systemd.start_task,
        "stop": systemd.stop_task,
        "enable-timer": systemd.enable_timer,
        "disable-timer": systemd.disable_timer,
        "update": systemd.update_code,
    }
    handler = actions.get(action)
    if handler is None:
        flash(request, f"未知操作: {action}", "error")
        return redirect("/")

    result = handler()
    category = "success" if result.ok else "error"
    flash(request, result.output or "操作已提交。", category)
    return redirect("/")
