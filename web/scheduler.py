import os
import random
import time
from datetime import datetime, timedelta

from web import systemd


def configured_run_time() -> str:
    value = os.environ.get("COMMUNITY_KEEPER_RUN_TIME", "00:10").strip() or "00:10"
    if ":" not in value:
        return "00:10"
    return value


def random_delay_seconds() -> int:
    raw = os.environ.get("COMMUNITY_KEEPER_RANDOM_DELAY_SECONDS", "600").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 600


def next_run_after(now: datetime) -> datetime:
    hour_text, minute_text = configured_run_time().split(":", 1)
    candidate = now.replace(
        hour=int(hour_text),
        minute=int(minute_text),
        second=0,
        microsecond=0,
    )
    if candidate <= now:
        candidate += timedelta(days=1)
    delay = random.randint(0, random_delay_seconds())
    return candidate + timedelta(seconds=delay)


def write_state(message: str) -> None:
    systemd.SCHEDULER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    systemd.SCHEDULER_STATE_FILE.write_text(message, encoding="utf-8")


def scheduler_enabled_by_default() -> bool:
    raw = os.environ.get("COMMUNITY_KEEPER_SCHEDULER_ENABLED", "true")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def ensure_initial_enabled_state() -> None:
    if scheduler_enabled_by_default() and not systemd.SCHEDULER_ENABLED_FILE.exists():
        systemd.SCHEDULER_ENABLED_FILE.parent.mkdir(parents=True, exist_ok=True)
        systemd.SCHEDULER_ENABLED_FILE.write_text("enabled\n", encoding="utf-8")


def main() -> None:
    ensure_initial_enabled_state()
    systemd.append_log("Docker scheduler started")

    while True:
        if not systemd.SCHEDULER_ENABLED_FILE.exists():
            write_state("Scheduler disabled.")
            time.sleep(30)
            continue

        run_at = next_run_after(datetime.now())
        write_state(f"Scheduler enabled.\nNext run: {run_at.isoformat(sep=' ', timespec='seconds')}")

        while datetime.now() < run_at:
            if not systemd.SCHEDULER_ENABLED_FILE.exists():
                break
            time.sleep(min(30, max(1, int((run_at - datetime.now()).total_seconds()))))

        if not systemd.SCHEDULER_ENABLED_FILE.exists():
            continue

        result = systemd.start_task()
        systemd.append_log(f"Scheduled run trigger: {result.output}")
        time.sleep(60)


if __name__ == "__main__":
    main()
