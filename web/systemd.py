import os
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List

from web import env_store


TASK_SERVICE = os.environ.get("COMMUNITY_KEEPER_SERVICE", "community-keeper.service")
TASK_TIMER = os.environ.get("COMMUNITY_KEEPER_TIMER", "community-keeper.timer")
INSTALL_DIR = os.environ.get("INSTALL_DIR", "/opt/community-keeper")
RUN_SCRIPT = os.path.join(INSTALL_DIR, "scripts/run.sh")
RUNTIME = os.environ.get("COMMUNITY_KEEPER_RUNTIME", "process").strip().lower()
LOG_FILE = Path(os.environ.get("COMMUNITY_KEEPER_LOG_FILE", "/var/log/community-keeper/run.log"))
PID_FILE = Path(os.environ.get("COMMUNITY_KEEPER_PID_FILE", "/tmp/community-keeper.pid"))
SCHEDULER_ENABLED_FILE = Path(
    os.environ.get("COMMUNITY_KEEPER_SCHEDULER_ENABLED_FILE", "/tmp/community-keeper-scheduler.enabled")
)
SCHEDULER_STATE_FILE = Path(
    os.environ.get("COMMUNITY_KEEPER_SCHEDULER_STATE_FILE", "/tmp/community-keeper-scheduler.state")
)


@dataclass
class CommandResult:
    ok: bool
    output: str


def run_command(command: List[str], timeout: int = 30) -> CommandResult:
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        return CommandResult(False, str(exc))
    except subprocess.TimeoutExpired:
        return CommandResult(False, "Command timed out")

    output = "\n".join(
        part.strip()
        for part in [completed.stdout, completed.stderr]
        if part and part.strip()
    )
    return CommandResult(completed.returncode == 0, output)


def systemctl(*args: str, timeout: int = 30) -> CommandResult:
    return run_command(["systemctl", *args], timeout=timeout)


def is_process_runtime() -> bool:
    return RUNTIME in {"process", "docker", "compose"}


def merged_env() -> dict:
    env = os.environ.copy()
    env.update(env_store.read_values())
    env.setdefault("INSTALL_DIR", INSTALL_DIR)
    env.setdefault("PYTHON_BIN", env.get("PYTHON_BIN", "python3"))
    env.setdefault("AUTO_UPDATE", "false")
    return env


def ensure_log_dir() -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)


def append_log(message: str) -> None:
    ensure_log_dir()
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(f"\n[{timestamp}] {message}\n")


def read_pid() -> int:
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return 0


def process_is_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def clear_stale_pid() -> None:
    pid = read_pid()
    if pid and not process_is_running(pid):
        try:
            PID_FILE.unlink()
        except OSError:
            pass


def start_process_task(args: List[str], label: str) -> CommandResult:
    clear_stale_pid()
    pid = read_pid()
    if process_is_running(pid):
        return CommandResult(False, f"community-keeper is already running, pid={pid}")

    ensure_log_dir()
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    append_log(f"Starting {label}")
    log_handle = LOG_FILE.open("a", encoding="utf-8")
    try:
        process = subprocess.Popen(
            ["/usr/bin/env", "bash", RUN_SCRIPT, *args],
            cwd=INSTALL_DIR,
            env=merged_env(),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    except FileNotFoundError as exc:
        log_handle.close()
        return CommandResult(False, str(exc))

    PID_FILE.write_text(str(process.pid), encoding="utf-8")
    return CommandResult(True, f"{label} started, pid={process.pid}")


def start_task() -> CommandResult:
    if is_process_runtime():
        return start_process_task(["--run-only"], "manual run")
    return systemctl("start", TASK_SERVICE, timeout=10)


def stop_task() -> CommandResult:
    if is_process_runtime():
        pid = read_pid()
        if not process_is_running(pid):
            clear_stale_pid()
            return CommandResult(True, "No running community-keeper process.")
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            clear_stale_pid()
            return CommandResult(True, "Process already stopped.")
        append_log(f"Stopped process pid={pid}")
        return CommandResult(True, f"Stop signal sent to pid={pid}")
    return systemctl("stop", TASK_SERVICE, timeout=10)


def enable_timer() -> CommandResult:
    if is_process_runtime():
        SCHEDULER_ENABLED_FILE.parent.mkdir(parents=True, exist_ok=True)
        SCHEDULER_ENABLED_FILE.write_text("enabled\n", encoding="utf-8")
        return CommandResult(True, "Scheduler enabled.")
    return systemctl("enable", "--now", TASK_TIMER, timeout=10)


def disable_timer() -> CommandResult:
    if is_process_runtime():
        try:
            SCHEDULER_ENABLED_FILE.unlink()
        except FileNotFoundError:
            pass
        return CommandResult(True, "Scheduler disabled.")
    return systemctl("disable", "--now", TASK_TIMER, timeout=10)


def update_code() -> CommandResult:
    if is_process_runtime():
        return start_process_task(["--update-only"], "code update")
    return run_command(["/usr/bin/env", "bash", RUN_SCRIPT, "--update-only"], timeout=180)


def service_status() -> str:
    if is_process_runtime():
        clear_stale_pid()
        pid = read_pid()
        if process_is_running(pid):
            return f"Runtime: process\nStatus: running\nPID: {pid}\nLog: {LOG_FILE}"
        return f"Runtime: process\nStatus: idle\nLog: {LOG_FILE}"
    result = systemctl("status", TASK_SERVICE, "--no-pager", timeout=10)
    return result.output


def timer_status() -> str:
    if is_process_runtime():
        enabled = SCHEDULER_ENABLED_FILE.exists()
        state = ""
        if SCHEDULER_STATE_FILE.exists():
            state = SCHEDULER_STATE_FILE.read_text(encoding="utf-8")
        return (
            "Runtime: process\n"
            f"Scheduler: {'enabled' if enabled else 'disabled'}\n"
            f"State file: {SCHEDULER_STATE_FILE}\n"
            f"{state}"
        )
    result = systemctl("status", TASK_TIMER, "--no-pager", timeout=10)
    return result.output


def next_runs() -> str:
    if is_process_runtime():
        if SCHEDULER_STATE_FILE.exists():
            return SCHEDULER_STATE_FILE.read_text(encoding="utf-8")
        return "Scheduler has not reported a next run yet."
    result = systemctl("list-timers", TASK_TIMER, "--no-pager", "--all", timeout=10)
    return result.output


def recent_logs(lines: int = 200) -> str:
    safe_lines = max(20, min(lines, 1000))
    if is_process_runtime():
        if not LOG_FILE.exists():
            return f"Log file does not exist yet: {LOG_FILE}"
        content = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(content[-safe_lines:])
    result = run_command(
        [
            "journalctl",
            "-u",
            TASK_SERVICE,
            "-n",
            str(safe_lines),
            "--no-pager",
        ],
        timeout=20,
    )
    return result.output
