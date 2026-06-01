"""
cron: 0 */6 * * *
new Env("Community Keeper")
"""

import importlib
import os
import re
import time
from typing import Dict, List, Optional, Set

from loguru import logger
from core.runner import TaskRunner
from nodeseek import NodeSeekDailyMission
from notify import NotificationManager
from tasks.function_task import FunctionTask
from tasks.naixi import NaixiForumTask
from v2ex import V2EXDailyMission


def load_env_file(path: str, override: bool = False) -> bool:
    if not path or not os.path.isfile(path):
        return False

    loaded_any = False
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if "=" not in line:
                    continue

                key, value = line.split("=", 1)
                key = key.strip()
                if not key:
                    continue

                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                    value = value[1:-1]

                current_value = os.environ.get(key, "")
                if override or not (
                    isinstance(current_value, str) and current_value.strip()
                ):
                    os.environ[key] = value
                    loaded_any = True
    except OSError as exc:
        logger.warning(f"Failed to load env file {path}: {exc}")
        return False

    return loaded_any


def preload_env_files() -> List[str]:
    repo_dir = os.path.dirname(os.path.abspath(__file__))
    candidates: List[str] = []
    env_file_hint = os.environ.get("LINUXDO_ENV_FILE", "").strip()
    if env_file_hint:
        candidates.append(env_file_hint)

    candidates.extend(
        [
            os.path.join(repo_dir, "community-keeper.env"),
            os.path.join(repo_dir, ".env"),
            "/etc/community-keeper.env",
        ]
    )

    loaded_paths: List[str] = []
    seen_paths: Set[str] = set()
    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if normalized in seen_paths:
            continue
        seen_paths.add(normalized)
        if load_env_file(normalized):
            loaded_paths.append(normalized)

    return loaded_paths


def resolve_default_env_file_path() -> str:
    candidates = ["/etc/community-keeper.env"]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return candidates[0]


def env_str(name: str, default: str = "") -> str:
    value = os.environ.get(name, default)
    return value.strip() if isinstance(value, str) else default


def env_bool(name: str, default: bool = False) -> bool:
    value = env_str(name)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    value = env_str(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning(f"环境变量 {name} 不是有效整数: {value!r}，将回退到 {default}")
        return default


PRELOADED_ENV_FILES = preload_env_files()
if PRELOADED_ENV_FILES:
    logger.info("Preloaded env file(s): " + ", ".join(PRELOADED_ENV_FILES))


ENV_FILE_PATH = env_str("LINUXDO_ENV_FILE", resolve_default_env_file_path())
USERNAME = env_str("LINUXDO_USERNAME") or env_str("USERNAME")
PASSWORD = env_str("LINUXDO_PASSWORD") or env_str("PASSWORD")
COOKIES = env_str("LINUXDO_COOKIES")
LINUXDO_HEADLESS = env_bool("LINUXDO_HEADLESS", False)
DEFAULT_IMPERSONATE = env_str("IMPERSONATE_VERSION", "chrome136") or "chrome136"

V2EX_COOKIE = env_str("V2EX_COOKIE") or env_str("V2EX_COOKIES")
V2EX_A2 = env_str("V2EX_A2")
if not V2EX_COOKIE and V2EX_A2:
    V2EX_COOKIE = f"A2={V2EX_A2}"
V2EX_ENABLED = env_bool("V2EX_ENABLED", bool(V2EX_COOKIE))

NODESEEK_NAME = env_str("NODESEEK_NAME")
NODESEEK_COOKIE = env_str("NODESEEK_COOKIE") or env_str("NS_COOKIE")
NODESEEK_RANDOM = env_bool("NODESEEK_RANDOM", env_bool("NS_RANDOM", True))
NODESEEK_HEADLESS = env_bool("NODESEEK_HEADLESS", True)
NODESEEK_IMPERSONATE = (
    env_str("NODESEEK_IMPERSONATE")
    or env_str("NS_IMPERSONATE")
    or DEFAULT_IMPERSONATE
)
NODESEEK_ACCOUNT_DELAY_SECONDS = env_int("NODESEEK_ACCOUNT_DELAY_SECONDS", 300)

NODESEEK_INDEXED_ENV_PATTERN = re.compile(
    r"^(?:"
    r"NODESEEK_(?:COOKIE|NAME|RANDOM|HEADLESS|IMPERSONATE)"
    r"|NS_(?:COOKIE|RANDOM|IMPERSONATE)"
    r")_(\d+)$"
)


def indexed_env_name(base_name: str, index: Optional[int] = None) -> str:
    if index is None:
        return base_name
    return f"{base_name}_{index}"


def indexed_env_str(
    base_name: str,
    index: Optional[int] = None,
    aliases: Optional[List[str]] = None,
    default: str = "",
) -> str:
    for name in [base_name] + (aliases or []):
        value = env_str(indexed_env_name(name, index))
        if value:
            return value
    return default


def indexed_env_bool(
    base_name: str,
    index: Optional[int] = None,
    default: bool = False,
    aliases: Optional[List[str]] = None,
) -> bool:
    for name in [base_name] + (aliases or []):
        raw = os.environ.get(indexed_env_name(name, index))
        if raw is None:
            continue
        if not isinstance(raw, str):
            return bool(raw)
        value = raw.strip()
        if not value:
            continue
        return value.lower() in {"1", "true", "yes", "on"}
    return default


def indexed_env_name_with_value(
    base_name: str,
    index: Optional[int] = None,
    aliases: Optional[List[str]] = None,
) -> str:
    for name in [base_name] + (aliases or []):
        candidate = indexed_env_name(name, index)
        if env_str(candidate):
            return candidate
    return indexed_env_name(base_name, index)


def collect_nodeseek_account_indexes() -> List[int]:
    indexes: Set[int] = set()
    for key, value in os.environ.items():
        if not isinstance(value, str) or not value.strip():
            continue
        match = NODESEEK_INDEXED_ENV_PATTERN.match(key)
        if match:
            indexes.add(int(match.group(1)))
    return sorted(indexes)


def build_nodeseek_account_config(index: Optional[int] = None) -> Optional[Dict[str, object]]:
    cookie = indexed_env_str(
        "NODESEEK_COOKIE",
        index,
        aliases=["NS_COOKIE"],
        default=NODESEEK_COOKIE if index is None else "",
    )
    if not cookie:
        return None

    account_name = indexed_env_str("NODESEEK_NAME", index, default="")
    if not account_name:
        if index is not None:
            account_name = f"Account #{index}"
        else:
            account_name = "Default account"

    return {
        "index": index,
        "account_name": account_name,
        "cookie_str": cookie,
        "cookie_env_var_name": indexed_env_name_with_value(
            "NODESEEK_COOKIE",
            index,
            aliases=["NS_COOKIE"],
        ),
        "attendance_random": indexed_env_bool(
            "NODESEEK_RANDOM",
            index,
            default=NODESEEK_RANDOM,
            aliases=["NS_RANDOM"],
        ),
        "headless": indexed_env_bool(
            "NODESEEK_HEADLESS",
            index,
            default=NODESEEK_HEADLESS,
        ),
        "impersonate": indexed_env_str(
            "NODESEEK_IMPERSONATE",
            index,
            aliases=["NS_IMPERSONATE"],
            default=NODESEEK_IMPERSONATE,
        ),
    }


def collect_nodeseek_accounts() -> List[Dict[str, object]]:
    indexed_accounts = collect_nodeseek_account_indexes()
    accounts: List[Dict[str, object]] = []

    if indexed_accounts:
        for index in indexed_accounts:
            config = build_nodeseek_account_config(index)
            if config:
                accounts.append(config)
            else:
                logger.warning(
                    f"Skipping NodeSeek account #{index}: missing cookie"
                )
        return accounts

    single_account = build_nodeseek_account_config()
    if single_account:
        accounts.append(single_account)
    return accounts


NODESEEK_ENABLED = env_bool("NODESEEK_ENABLED", bool(collect_nodeseek_accounts()))


def has_linuxdo_credentials() -> bool:
    return bool(COOKIES or (USERNAME and PASSWORD))


def load_linuxdo_cloak_module():
    return importlib.import_module("linuxdo_cloak")


def run_v2ex_task() -> bool:
    return V2EXDailyMission(V2EX_COOKIE).run()


def run_nodeseek_tasks(nodeseek_accounts: List[Dict[str, object]]) -> bool:
    logger.info(f"Configured {len(nodeseek_accounts)} NodeSeek account(s)")
    all_ok = True
    for position, account in enumerate(nodeseek_accounts):
        if position > 0 and NODESEEK_ACCOUNT_DELAY_SECONDS > 0:
            logger.info(
                "Waiting "
                f"{NODESEEK_ACCOUNT_DELAY_SECONDS}s before next NodeSeek account "
                "to reduce same-IP rate limiting"
            )
            time.sleep(NODESEEK_ACCOUNT_DELAY_SECONDS)
        ok = NodeSeekDailyMission(
            cookie_str=account["cookie_str"],
            env_file_path=ENV_FILE_PATH,
            notifier=NotificationManager(),
            attendance_random=account["attendance_random"],
            impersonate=account["impersonate"],
            headless=account["headless"],
            cookie_env_var_name=account["cookie_env_var_name"],
            account_name=account["account_name"],
        ).run()
        all_ok = bool(ok) and all_ok
    return all_ok


def run_linuxdo_task() -> bool:
    linuxdo_cloak = load_linuxdo_cloak_module()
    return linuxdo_cloak.run_linuxdo_task(headless=LINUXDO_HEADLESS)


def run_configured_tasks() -> None:
    linuxdo_enabled = has_linuxdo_credentials()
    has_v2ex_credentials = bool(V2EX_ENABLED and V2EX_COOKIE)
    nodeseek_accounts = collect_nodeseek_accounts() if NODESEEK_ENABLED else []
    has_nodeseek_credentials = bool(NODESEEK_ENABLED and nodeseek_accounts)
    naixi_task = NaixiForumTask()

    logger.info(
        "Runtime task summary: "
        f"linuxdo={linuxdo_enabled}, "
        f"v2ex={has_v2ex_credentials}, "
        f"nodeseek_enabled={NODESEEK_ENABLED}, "
        f"nodeseek_accounts={len(nodeseek_accounts)}, "
        f"naixi={naixi_task.is_configured()}"
    )
    if nodeseek_accounts:
        logger.info(
            "NodeSeek accounts: "
            + ", ".join(str(account["account_name"]) for account in nodeseek_accounts)
        )

    if (
        not linuxdo_enabled
        and not has_v2ex_credentials
        and not has_nodeseek_credentials
        and not naixi_task.is_configured()
    ):
        print(
            "请设置 LINUXDO_COOKIES 或 LINUXDO_USERNAME / LINUXDO_PASSWORD；"
            "如需启用 V2EX，请设置 V2EX_COOKIE 或 V2EX_A2；"
            "如需启用 NodeSeek，请设置 NODESEEK_COOKIE；"
            "如需启用奶昔论坛，请先设置 NAIXI_ENABLED=true 或 NAIXI_COOKIE"
        )
        raise SystemExit(1)

    TaskRunner().run(
        [
            FunctionTask(
                name="v2ex",
                enabled=has_v2ex_credentials,
                action=run_v2ex_task,
                skip_detail="未配置 V2EX Cookie，跳过 V2EX 每日签到",
            ),
            FunctionTask(
                name="nodeseek",
                enabled=has_nodeseek_credentials,
                action=lambda: run_nodeseek_tasks(nodeseek_accounts),
                skip_detail="未配置 NodeSeek Cookie，跳过 NodeSeek 每日签到",
            ),
            FunctionTask(
                name="linuxdo",
                enabled=linuxdo_enabled,
                action=run_linuxdo_task,
                skip_detail="未配置 LinuxDo 登录信息，跳过 LinuxDo 任务",
            ),
            naixi_task,
        ]
    )


if __name__ == "__main__":
    run_configured_tasks()
