import os
import re
from html import unescape
from typing import Dict, Optional
from urllib.parse import urljoin

from curl_cffi import requests
from loguru import logger

from core.task import TaskResult
from notify import NotificationManager


DEFAULT_BASE_URL = "https://forum.naixi.net/"
SIGN_PAGE_PATH = "k_misign-sign.html"


class NaixiForumTask:
    name = "naixi"

    def __init__(self, notifier: Optional[NotificationManager] = None) -> None:
        self.cookie = self.env_str("NAIXI_COOKIE") or self.env_str("NAIXI_COOKIES")
        self.base_url = DEFAULT_BASE_URL
        if not self.base_url.endswith("/"):
            self.base_url += "/"
        self.impersonate = "chrome136"
        self.timeout = 25
        self.notifier = notifier or NotificationManager()

    @staticmethod
    def env_str(name: str, default: str = "") -> str:
        value = os.environ.get(name, default)
        return value.strip() if isinstance(value, str) else default

    def is_configured(self) -> bool:
        return bool(self.cookie)

    def build_session(self):
        session = requests.Session()
        session.headers.update(
            {
                "Cookie": self.cookie,
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/136.0.0.0 Safari/537.36"
                ),
                "Referer": self.sign_page_url,
            }
        )
        return session

    @property
    def sign_page_url(self) -> str:
        return urljoin(self.base_url, SIGN_PAGE_PATH)

    @staticmethod
    def normalize_text(value: str) -> str:
        return re.sub(r"\s+", " ", unescape(value or "")).strip()

    @classmethod
    def parse_input_value(cls, html: str, element_id: str) -> str:
        match = re.search(
            rf'id="{re.escape(element_id)}"[^>]*value="([^"]*)"',
            html,
            re.S,
        )
        return cls.normalize_text(match.group(1)) if match else ""

    @classmethod
    def parse_sign_href(cls, html: str) -> str:
        match = re.search(r'<a id="JD_sign"[^>]+href="([^"]+)"', html, re.S)
        return unescape(match.group(1)) if match else ""

    @classmethod
    def parse_author(cls, html: str) -> str:
        candidates = re.findall(r'class="author"[^>]*>(.*?)</a>', html, re.S)
        for candidate in candidates:
            value = cls.normalize_text(candidate)
            if value and "{{" not in value:
                return value
        return ""

    @classmethod
    def parse_font_message(cls, html: str) -> str:
        match = re.search(r'<div class="font">\s*(.*?)\s*</div>', html, re.S)
        return cls.normalize_text(match.group(1)) if match else ""

    @classmethod
    def parse_sign_summary(cls, html: str) -> Dict[str, object]:
        return {
            "username": cls.parse_author(html),
            "rank": cls.parse_input_value(html, "qiandaobtnnum"),
            "continuous_days": cls.parse_input_value(html, "lxdays"),
            "level": cls.parse_input_value(html, "lxlevel"),
            "reward": cls.parse_input_value(html, "lxreward"),
            "total_days": cls.parse_input_value(html, "lxtdays"),
            "message": cls.parse_font_message(html),
            "signed": "今日已签" in html or "您的签到排名" in html,
            "not_signed": "您今天还没有签到" in html,
            "sign_href": cls.parse_sign_href(html),
        }

    def fetch_sign_page(self, session) -> str:
        response = session.get(
            self.sign_page_url,
            impersonate=self.impersonate,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.text

    def execute_sign(self, session, sign_href: str) -> str:
        session.headers.update({"X-Requested-With": "XMLHttpRequest"})
        response = session.get(
            urljoin(self.base_url, sign_href),
            impersonate=self.impersonate,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.text

    def format_success_detail(self, summary: Dict[str, object]) -> str:
        parts = []
        username = summary.get("username")
        if username:
            parts.append(f"账号: {username}")
        if summary.get("rank"):
            parts.append(f"排名: {summary['rank']}")
        if summary.get("continuous_days"):
            parts.append(f"连续签到: {summary['continuous_days']} 天")
        if summary.get("level"):
            parts.append(f"签到等级: {summary['level']}")
        if summary.get("reward"):
            parts.append(f"积分奖励: {summary['reward']}")
        if summary.get("total_days"):
            parts.append(f"总天数: {summary['total_days']} 天")
        if summary.get("message"):
            parts.append(f"详情: {summary['message']}")
        return "；".join(parts) or "签到完成"

    def send_success_notification(self, summary: Dict[str, object]) -> None:
        lines = ["✅ 奶昔论坛签到完成"]
        detail = self.format_success_detail(summary)
        lines.extend(detail.split("；"))
        self.notifier.send_all("奶昔论坛", "\n".join(lines))

    def send_failure_notification(self, detail: str) -> None:
        self.notifier.send_all("奶昔论坛", f"❌ 奶昔论坛签到失败\n原因: {detail}")

    def run(self) -> TaskResult:
        if not self.is_configured():
            return TaskResult.skip(self.name, "未配置奶昔论坛，跳过")

        try:
            session = self.build_session()
            html = self.fetch_sign_page(session)
            summary = self.parse_sign_summary(html)
            if not summary.get("username"):
                detail = "Cookie 无效或未登录"
                self.send_failure_notification(detail)
                return TaskResult.fail(self.name, detail)

            if not summary.get("signed"):
                sign_href = str(summary.get("sign_href") or "")
                if not sign_href or "member.php?mod=logging" in sign_href:
                    detail = "未找到有效签到链接"
                    self.send_failure_notification(detail)
                    return TaskResult.fail(self.name, detail)
                logger.info(f"Naixi signing via {sign_href}")
                self.execute_sign(session, sign_href)
                html = self.fetch_sign_page(session)
                summary = self.parse_sign_summary(html)

            if summary.get("signed"):
                detail = self.format_success_detail(summary)
                self.send_success_notification(summary)
                return TaskResult.ok(self.name, detail)

            detail = self.format_success_detail(summary) or "签到后未确认成功"
            self.send_failure_notification(detail)
            return TaskResult.fail(self.name, detail)
        except Exception as exc:
            logger.exception(f"Naixi task failed: {exc}")
            detail = str(exc)
            self.send_failure_notification(detail)
            return TaskResult.fail(self.name, detail)
