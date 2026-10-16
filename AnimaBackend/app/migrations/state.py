"""这次启动时迁移器的结果,和据此要不要挡住接口(guard.py 读它)。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.migrations.runner import MigrationReport

Gate = Literal["open", "read_only", "closed"]


@dataclass
class StartupState:
    report: MigrationReport | None = None

    @property
    def gate(self) -> Gate:
        """open:照常。read_only:库被更新的版本升级过,只能看不能改。closed:升级失败,除了 health 全挡"""
        if self.report is None:
            return "open"
        if self.report.status == "failed":
            return "closed"
        if self.report.status == "blocked":
            return "read_only"
        return "open"

    @property
    def message(self) -> str:
        return self.report.message if self.report else ""


current = StartupState()


def set_report(report: MigrationReport | None) -> None:
    current.report = report
