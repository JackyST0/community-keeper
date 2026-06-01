from dataclasses import dataclass
from typing import Protocol


@dataclass
class TaskResult:
    name: str
    success: bool
    detail: str = ""
    skipped: bool = False

    @classmethod
    def ok(cls, name: str, detail: str = "") -> "TaskResult":
        return cls(name=name, success=True, detail=detail)

    @classmethod
    def fail(cls, name: str, detail: str = "") -> "TaskResult":
        return cls(name=name, success=False, detail=detail)

    @classmethod
    def skip(cls, name: str, detail: str = "") -> "TaskResult":
        return cls(name=name, success=True, detail=detail, skipped=True)


class CommunityTask(Protocol):
    name: str

    def run(self) -> TaskResult:
        ...
