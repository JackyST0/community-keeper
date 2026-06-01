from typing import Callable

from loguru import logger

from core.task import TaskResult


class FunctionTask:
    def __init__(
        self,
        name: str,
        enabled: bool,
        action: Callable[[], bool],
        skip_detail: str,
    ) -> None:
        self.name = name
        self.enabled = enabled
        self.action = action
        self.skip_detail = skip_detail

    def run(self) -> TaskResult:
        if not self.enabled:
            return TaskResult.skip(self.name, self.skip_detail)

        logger.info(f"Starting {self.name} task")
        ok = bool(self.action())
        if ok:
            return TaskResult.ok(self.name, "finished")
        return TaskResult.fail(self.name, "returned false")
