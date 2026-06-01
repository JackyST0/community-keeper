import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional


DEFAULT_ENV_FILE = "/etc/community-keeper.env"
KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")


@dataclass(frozen=True)
class EnvField:
    key: str
    label: str
    group: str
    secret: bool = False
    textarea: bool = False
    placeholder: str = ""


FIELD_GROUPS: List[Dict[str, object]] = [
    {
        "name": "LinuxDo",
        "fields": [
            EnvField("LINUXDO_COOKIES", "Cookie", "LinuxDo", True, True),
            EnvField("LINUXDO_USERNAME", "用户名/邮箱", "LinuxDo"),
            EnvField("LINUXDO_PASSWORD", "密码", "LinuxDo", True),
            EnvField("BROWSE_ENABLED", "启用浏览任务", "LinuxDo", False, False, "true / false"),
            EnvField("LINUXDO_HEADLESS", "无头浏览器", "LinuxDo", False, False, "true / false"),
            EnvField("LINUXDO_USER_DATA_DIR", "浏览器资料目录", "LinuxDo"),
        ],
    },
    {
        "name": "V2EX",
        "fields": [
            EnvField("V2EX_ENABLED", "启用 V2EX", "V2EX", False, False, "true / false"),
            EnvField("V2EX_A2", "A2 Cookie", "V2EX", True),
            EnvField("V2EX_COOKIE", "完整 Cookie", "V2EX", True, True),
        ],
    },
    {
        "name": "NodeSeek",
        "fields": [
            EnvField("NODESEEK_ENABLED", "启用 NodeSeek", "NodeSeek", False, False, "true / false"),
            EnvField("NODESEEK_NAME", "账号名", "NodeSeek"),
            EnvField("NODESEEK_COOKIE", "Cookie", "NodeSeek", True, True),
            EnvField("NODESEEK_RANDOM", "随机签到参数", "NodeSeek", False, False, "true / false"),
            EnvField("NODESEEK_HEADLESS", "无头浏览器", "NodeSeek", False, False, "true / false"),
            EnvField("NODESEEK_IMPERSONATE", "请求指纹", "NodeSeek", False, False, "chrome136"),
            EnvField("NODESEEK_ACCOUNT_DELAY_SECONDS", "多账号间隔秒数", "NodeSeek", False, False, "300"),
        ],
    },
    {
        "name": "奶昔论坛",
        "fields": [
            EnvField("NAIXI_ENABLED", "启用奶昔", "奶昔论坛", False, False, "true / false"),
            EnvField("NAIXI_COOKIE", "Cookie", "奶昔论坛", True, True),
            EnvField("NAIXI_BASE_URL", "站点地址", "奶昔论坛", False, False, "https://forum.naixi.net/"),
            EnvField("NAIXI_IMPERSONATE", "请求指纹", "奶昔论坛", False, False, "chrome136"),
        ],
    },
    {
        "name": "通知",
        "fields": [
            EnvField("NOTIFY_TIMEZONE", "通知时区", "通知", False, False, "Asia/Shanghai"),
            EnvField("TELEGRAM_BOT_TOKEN", "Telegram Bot Token", "通知", True),
            EnvField("TELEGRAM_CHAT_ID", "Telegram Chat ID", "通知"),
            EnvField("GOTIFY_URL", "Gotify URL", "通知"),
            EnvField("GOTIFY_TOKEN", "Gotify Token", "通知", True),
            EnvField("SC3_PUSH_KEY", "ServerChan3 SendKey", "通知", True),
            EnvField("WXPUSH_URL", "wxpush URL", "通知"),
            EnvField("WXPUSH_TOKEN", "wxpush Token", "通知", True),
        ],
    },
    {
        "name": "管理后台",
        "fields": [
            EnvField("ADMIN_USERNAME", "后台用户名", "管理后台", False, False, "admin"),
            EnvField("ADMIN_PASSWORD", "后台密码", "管理后台", True),
            EnvField("ADMIN_PASSWORD_HASH", "后台密码哈希", "管理后台", True, True),
            EnvField("ADMIN_SESSION_SECRET", "会话密钥", "管理后台", True),
        ],
    },
]

FIELD_MAP: Dict[str, EnvField] = {
    field.key: field
    for group in FIELD_GROUPS
    for field in group["fields"]  # type: ignore[index]
}


@dataclass
class ParsedLine:
    raw: str
    key: Optional[str] = None
    value: Optional[str] = None


def env_file_path() -> Path:
    return Path(os.environ.get("COMMUNITY_KEEPER_ENV_FILE") or os.environ.get("LINUXDO_ENV_FILE") or DEFAULT_ENV_FILE)


def parse_env_line(raw_line: str) -> ParsedLine:
    stripped = raw_line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return ParsedLine(raw=raw_line)

    line = stripped[7:].strip() if stripped.startswith("export ") else stripped
    key, value = line.split("=", 1)
    key = key.strip()
    if not KEY_PATTERN.match(key):
        return ParsedLine(raw=raw_line)

    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return ParsedLine(raw=raw_line, key=key, value=value)


def read_lines(path: Path) -> List[ParsedLine]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as handle:
        return [parse_env_line(line.rstrip("\n")) for line in handle]


def read_values(path: Optional[Path] = None) -> Dict[str, str]:
    parsed_lines = read_lines(path or env_file_path())
    values: Dict[str, str] = {}
    for line in parsed_lines:
        if line.key is not None and line.value is not None:
            values[line.key] = line.value
    return values


def validate_key(key: str) -> None:
    if not KEY_PATTERN.match(key):
        raise ValueError(f"Invalid environment key: {key}")


def validate_value(key: str, value: str) -> None:
    validate_key(key)
    if "\n" in value or "\r" in value:
        raise ValueError(f"{key} cannot contain newlines")


def format_line(key: str, value: str) -> str:
    validate_value(key, value)
    return f"{key}={value}"


def write_values(updates: Dict[str, str], path: Optional[Path] = None) -> None:
    target = path or env_file_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    normalized = {key: value.strip() for key, value in updates.items()}
    for key, value in normalized.items():
        validate_value(key, value)

    parsed_lines = read_lines(target)
    seen = set()
    output: List[str] = []

    for line in parsed_lines:
        if line.key in normalized:
            output.append(format_line(line.key, normalized[line.key]))
            seen.add(line.key)
        else:
            output.append(line.raw)

    missing = [key for key in normalized if key not in seen]
    if missing and output and output[-1].strip():
        output.append("")
    for key in missing:
        output.append(format_line(key, normalized[key]))

    if target.exists():
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        shutil.copy2(target, target.with_suffix(target.suffix + f".bak.{timestamp}"))

    fd, temp_name = tempfile.mkstemp(prefix=target.name, dir=str(target.parent), text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("\n".join(output).rstrip() + "\n")
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def mask_value(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "********"
    return f"{value[:4]}...{value[-4:]}"


def known_field_keys() -> Iterable[str]:
    return FIELD_MAP.keys()
