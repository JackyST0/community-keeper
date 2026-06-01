from typing import Iterable, List

from loguru import logger

from core.task import CommunityTask, TaskResult


class TaskRunner:
    def run(self, tasks: Iterable[CommunityTask]) -> List[TaskResult]:
        results: List[TaskResult] = []
        for task in tasks:
            try:
                result = task.run()
            except Exception as exc:
                logger.exception(f"{task.name} task crashed: {exc}")
                result = TaskResult.fail(task.name, str(exc))

            if result.skipped:
                logger.info(f"{result.name} skipped: {result.detail}")
            elif result.success:
                logger.success(f"{result.name} completed: {result.detail}")
            else:
                logger.error(f"{result.name} failed: {result.detail}")
            results.append(result)
        return results
