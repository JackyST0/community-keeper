import json
import os
import re
from html import unescape
from typing import Dict, List, Optional
from urllib.parse import urljoin

from curl_cffi import requests
from curl_cffi.requests.exceptions import HTTPError
from loguru import logger

from core.task import TaskResult
from notify import NotificationManager


DEFAULT_BASE_URL = "https://forum.naixi.net/"
SIGN_PAGE_PATH = "k_misign-sign.html"
IP_BOUND_COOKIE_NAMES = {"cf_clearance", "naixi_6720_lip"}


class NaixiForumTask:
    name = "naixi"

    def __init__(self, notifier: Optional[NotificationManager] = None) -> None:
        self.cookie = self.env_str("NAIXI_COOKIE") or self.env_str("NAIXI_COOKIES")
        self.base_url = DEFAULT_BASE_URL
        if not self.base_url.endswith("/"):
            self.base_url += "/"
        self.impersonate = "chrome136"
        self.headless = self.env_bool("NAIXI_HEADLESS", False)
        self.timeout = 25
        self.notifier = notifier or NotificationManager()

    @staticmethod
    def env_str(name: str, default: str = "") -> str:
        value = os.environ.get(name, default)
        return value.strip() if isinstance(value, str) else default

    @classmethod
    def env_bool(cls, name: str, default: bool = False) -> bool:
        value = cls.env_str(name)
        if not value:
            return default
        return value.lower() in {"1", "true", "yes", "on"}

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

    @staticmethod
    def parse_cookie_string(cookie: str, include_ip_bound: bool = True) -> List[dict]:
        cookies = []
        for part in cookie.strip().split(";"):
            part = part.strip()
            if "=" not in part:
                continue
            name, _, value = part.partition("=")
            name = name.strip()
            if not include_ip_bound and name.lower() in IP_BOUND_COOKIE_NAMES:
                continue
            cookies.append(
                {
                    "name": name,
                    "value": value.strip(),
                    "domain": ".naixi.net",
                    "path": "/",
                }
            )
        return cookies

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

    @staticmethod
    def wait_for_cloudflare(browser, max_wait: int = 60, stage: str = "页面") -> bool:
        import time

        waited = 0
        logger.info(f"Naixi {stage}: 等待安全检查，最多 {max_wait} 秒")
        while waited < max_wait:
            title = str(getattr(browser, "title", "") or "").lower()
            url = str(getattr(browser, "url", "") or "").lower()
            html = str(getattr(browser, "html", "") or "").lower()
            is_challenge = (
                "just a moment" in title
                or "challenge" in url
                or "cf-challenge" in html
                or "checking your browser" in html
            )
            if not is_challenge:
                logger.info(f"Naixi {stage}: 安全检查已通过")
                return True
            time.sleep(2)
            waited += 2
            if waited % 10 == 0:
                logger.info(f"Naixi {stage}: 仍在等待安全检查，已等待 {waited} 秒")
        return False

    def build_browser(self):
        from DrissionPage import ChromiumOptions, ChromiumPage

        co = (
            ChromiumOptions()
            .auto_port()
            .headless(self.headless)
            .incognito(True)
            .set_argument("--no-sandbox")
            .set_argument("--disable-blink-features=AutomationControlled")
            .set_argument("--disable-dev-shm-usage")
            .set_user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/136.0.0.0 Safari/537.36"
            )
        )
        logger.info("Naixi 正在启动 Chromium 浏览器")
        return ChromiumPage(co)

    def fetch_sign_page_via_browser(self, browser) -> str:
        logger.info("Naixi 正在打开签到页面")
        browser.get(self.sign_page_url, timeout=45)
        logger.info(
            f"Naixi 签到页面已打开: title={str(getattr(browser, 'title', '') or '')[:60]}"
        )
        if not self.wait_for_cloudflare(browser, stage="签到页面"):
            raise RuntimeError("浏览器仍停留在安全检查页面，请稍后重试")
        return str(getattr(browser, "html", "") or "")

    def prime_browser_cookies(self, browser) -> None:
        logger.info("Naixi 正在打开论坛首页以初始化浏览器上下文")
        browser.get(self.base_url, timeout=45)
        logger.info("Naixi 正在注入完整 Cookie，包括 cf_clearance")
        browser.set.cookies(self.parse_cookie_string(self.cookie, include_ip_bound=True))

    def execute_sign_via_browser(self, browser, sign_href: str) -> str:
        sign_url = urljoin(self.base_url, sign_href)
        logger.info("Naixi 正在浏览器会话内请求签到接口")
        js_code = (
            "return (async () => {"
            f"  const resp = await fetch({json.dumps(sign_url)}, {{"
            "    method: 'GET',"
            "    credentials: 'include',"
            "    headers: {"
            "      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',"
            "      'X-Requested-With': 'XMLHttpRequest'"
            "    },"
            "  });"
            "  const text = await resp.text();"
            "  return JSON.stringify({ status: resp.status, body: text });"
            "})();"
        )
        result_json = browser.run_js(js_code)
        result = json.loads(result_json or "{}")
        status = int(result.get("status") or 0)
        body = str(result.get("body") or "")
        if status and status != 200:
            raise RuntimeError(f"签到接口返回 HTTP {status}")
        return body

    def run_via_browser(self) -> TaskResult:
        logger.info("Naixi using browser mode")
        browser = None
        try:
            browser = self.build_browser()
            logger.info("Naixi Chromium 浏览器已启动")
            self.prime_browser_cookies(browser)
            html = self.fetch_sign_page_via_browser(browser)
            summary = self.parse_sign_summary(html)
            if not summary.get("username"):
                detail = "Cookie 无效或未登录，或浏览器安全检查未通过"
                self.send_failure_notification(detail)
                return TaskResult.fail(self.name, detail)

            if not summary.get("signed"):
                sign_href = str(summary.get("sign_href") or "")
                if not sign_href or "member.php?mod=logging" in sign_href:
                    detail = "未找到有效签到链接"
                    self.send_failure_notification(detail)
                    return TaskResult.fail(self.name, detail)
                logger.info(f"Naixi signing via browser: {sign_href}")
                self.execute_sign_via_browser(browser, sign_href)
                html = self.fetch_sign_page_via_browser(browser)
                summary = self.parse_sign_summary(html)

            if summary.get("signed"):
                detail = self.format_success_detail(summary)
                self.send_success_notification(summary)
                return TaskResult.ok(self.name, detail)

            detail = self.format_success_detail(summary) or "签到后未确认成功"
            self.send_failure_notification(detail)
            return TaskResult.fail(self.name, detail)
        except Exception as exc:
            detail = self.format_exception_detail(exc)
            logger.error(f"Naixi browser task failed: {detail}")
            self.send_failure_notification(detail)
            return TaskResult.fail(self.name, detail)
        finally:
            if browser is not None:
                try:
                    browser.quit()
                except Exception:
                    pass

    def run_via_http(self) -> TaskResult:
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

    @staticmethod
    def format_exception_detail(exc: Exception) -> str:
        if isinstance(exc, HTTPError):
            response = getattr(exc, "response", None)
            status_code = getattr(response, "status_code", None)
            if status_code in {401, 403}:
                return f"奶昔论坛返回 HTTP {status_code}，可能是 Cookie 失效或触发安全检查，请更新 Cookie 后重试"
            if status_code:
                return f"奶昔论坛返回 HTTP {status_code}，请稍后重试"
        return str(exc) or exc.__class__.__name__

    def run(self) -> TaskResult:
        if not self.is_configured():
            return TaskResult.skip(self.name, "未配置奶昔论坛，跳过")

        try:
            if self.env_bool("NAIXI_HTTP_ONLY", False):
                return self.run_via_http()
            return self.run_via_browser()
        except Exception as exc:
            detail = self.format_exception_detail(exc)
            logger.error(f"Naixi task failed: {detail}")
            self.send_failure_notification(detail)
            return TaskResult.fail(self.name, detail)
