import { compactText, fail, fetchJson, ok, parseNumber } from "./utils.js";

const BASE_URL = "https://www.nodeseek.com";

async function getActiveNodeSeekTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) return null;

  try {
    const url = new URL(tab.url);
    if (url.hostname === "nodeseek.com" || url.hostname.endsWith(".nodeseek.com")) {
      return tab;
    }
  } catch {
    return null;
  }
  return null;
}

async function runInActiveNodeSeekTab(context = {}) {
  const log = context.log || (async () => {});
  await log("查找当前 NodeSeek 标签页");
  const tab = await getActiveNodeSeekTab();
  if (!tab) return null;

  await log("在当前页面执行 NodeSeek 签到请求");
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: async () => {
      const compactText = (value, limit = 220) =>
        String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);

      const parseNumber = (value) => {
        const match = String(value ?? "").replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
        if (!match) return null;
        const number = Number(match[0]);
        return Number.isFinite(number) ? number : null;
      };

      const isAlreadyDone = (message) =>
        ["今日已签到", "今日已领取", "今天已完成签到", "请勿重复操作", "already", "claimed"].some((item) =>
          String(message || "").toLowerCase().includes(item.toLowerCase())
        );

      const readJson = async (url, options = {}) => {
        const response = await fetch(url, {
          redirect: "follow",
          credentials: "include",
          cache: "no-store",
          ...options,
          headers: {
            Accept: "application/json, text/plain, */*",
            ...(options.headers || {}),
          },
        });
        const text = await response.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }
        return { status: response.status, ok: response.ok, text, data };
      };

      const normalizeCreditRecord = (record) => {
        if (Array.isArray(record) && record.length >= 4) {
          return {
            amount: parseNumber(record[0]),
            balance: parseNumber(record[1]),
            description: String(record[2] || ""),
          };
        }
        if (!record || typeof record !== "object") return null;
        const description = record.description || record.desc || record.title || record.reason || "";
        const amount = parseNumber(record.amount ?? record.value ?? record.credit ?? record.delta ?? record.change);
        const balance = parseNumber(record.balance ?? record.currentBalance ?? record.total ?? record.current ?? record.after);
        return { description, amount, balance };
      };

      const pickList = (value) => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];
        for (const key of ["credits", "data", "list", "rows", "records", "items"]) {
          if (Array.isArray(value[key])) return value[key];
          if (value[key] && typeof value[key] === "object") {
            const nested = pickList(value[key]);
            if (nested.length) return nested;
          }
        }
        return [];
      };

      const getCreditSummary = async () => {
        const credit = await readJson("/api/account/credit/page-1");
        if (!credit.ok) return {};
        const records = pickList(credit.data);
        if (!Array.isArray(records)) return {};

        const normalized = records.map(normalizeCreditRecord).filter(Boolean);
        const signinRecords = normalized.filter((record) => String(record.description || "").includes("签到"));
        const latestBalance = normalized.find((record) => record.balance !== null)?.balance ?? null;
        const todayReward = signinRecords.find((record) => record.amount !== null)?.amount ?? null;
        const streakMatch = String(signinRecords[0]?.description || "").match(/连续签到\s*(\d+)\s*天/);
        return {
          todayReward,
          currentBalance: latestBalance,
          currentStreak: streakMatch ? Number(streakMatch[1]) : null,
        };
      };

      const getProfileSummary = async () => {
        const baseUser = (window.__config__ && window.__config__.user) || {};
        let profile = {};
        let unread = {};

        const memberId = baseUser.member_id || baseUser.memberId || baseUser.id;
        if (memberId) {
          const info = await readJson(`/api/account/getInfo/${memberId}?readme=1`);
          if (info.ok) {
            profile = info.data.detail || info.data.user || info.data.data || info.data || {};
          }
        }

        const unreadResp = await readJson("/api/notification/unread-count");
        if (unreadResp.ok) {
          unread = unreadResp.data.unreadCount || unreadResp.data.data || unreadResp.data || {};
        }

        const user = { ...baseUser, ...profile };
        return {
          username:
            user.username ||
            user.name ||
            user.nickname ||
            baseUser.username ||
            document.querySelector("[href^='/space/'], [href^='/user/'], .username")?.textContent?.trim() ||
            "",
          level: parseNumber(user.rank ?? user.level),
          chickenLegs: parseNumber(user.coin ?? user.credit ?? user.chicken_legs ?? user.chickenLegs),
          stardust: parseNumber(user.stardust),
          topics: parseNumber(user.nPost ?? user.posts ?? user.topicCount),
          comments: parseNumber(user.nComment ?? user.comments ?? user.commentCount),
          fans: parseNumber(user.fans ?? user.fanCount),
          notifications: parseNumber(unread.all ?? unread.total ?? unread.count),
          collections: parseNumber(user.collectionCount ?? user.collections),
        };
      };

      const attendance = await readJson("/api/attendance?random=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      const message = String(attendance.data.message || attendance.data.msg || "").trim();
      const bodyLooksHtml = /<html|<!doctype/i.test(attendance.text);

      if (!attendance.ok && !isAlreadyDone(message)) {
        if (attendance.status === 401 || attendance.status === 403) {
          return {
            success: false,
            detail: `NodeSeek 签到接口返回 HTTP ${attendance.status}，当前页面请求也被拒绝，请刷新页面或先手动通过安全检查`,
          };
        }
        if (bodyLooksHtml) {
          return {
            success: false,
            detail: `NodeSeek 返回 HTML 页面，可能仍在安全检查中: HTTP ${attendance.status}`,
          };
        }
        return {
          success: false,
          detail: `NodeSeek 签到失败: HTTP ${attendance.status} ${compactText(attendance.text, 120)}`,
        };
      }

      if (attendance.data.success !== true && !isAlreadyDone(message)) {
        return {
          success: false,
          detail: message || `NodeSeek 签到失败: ${compactText(attendance.text, 120)}`,
        };
      }

      const summary = await getCreditSummary();
      const profile = await getProfileSummary();
      const parts = [`状态: ${isAlreadyDone(message) ? "今日已签到" : "签到完成"}`];
      if (message) parts.push(`结果: ${message}`);
      if (profile.username) parts.push(`账号: ${profile.username}`);
      if (profile.level !== null && profile.level !== undefined) {
        parts.push(`等级: Lv ${profile.level}`);
      }
      if (summary.todayReward !== null && summary.todayReward !== undefined) {
        parts.push(`今日收益: ${summary.todayReward} 鸡腿`);
      }
      if (profile.chickenLegs !== null && profile.chickenLegs !== undefined) {
        parts.push(`当前鸡腿: ${profile.chickenLegs}`);
      } else if (summary.currentBalance !== null && summary.currentBalance !== undefined) {
        parts.push(`当前鸡腿: ${summary.currentBalance}`);
      }
      if (summary.currentStreak !== null && summary.currentStreak !== undefined) {
        parts.push(`连续签到: ${summary.currentStreak} 天`);
      }
      if (profile.stardust !== null && profile.stardust !== undefined) {
        parts.push(`星辰: ${profile.stardust}`);
      }
      if (profile.topics !== null && profile.topics !== undefined) {
        parts.push(`主题帖: ${profile.topics}`);
      }
      if (profile.comments !== null && profile.comments !== undefined) {
        parts.push(`评论数: ${profile.comments}`);
      }
      if (profile.fans !== null && profile.fans !== undefined) {
        parts.push(`粉丝: ${profile.fans}`);
      }
      if (profile.notifications !== null && profile.notifications !== undefined) {
        parts.push(`通知: ${profile.notifications}`);
      }
      if (profile.collections !== null && profile.collections !== undefined) {
        parts.push(`收藏: ${profile.collections}`);
      }
      return { success: true, detail: parts.join("\n") };
    },
  });

  const result = injection?.result || null;
  if (result?.success) {
    await log("读取 NodeSeek 签到和账号详情完成");
  }
  return result;
}

function isAlreadyDone(message) {
  return ["今日已签到", "今日已领取", "今天已完成签到", "请勿重复操作", "already", "claimed"].some((item) =>
    String(message || "").toLowerCase().includes(item.toLowerCase())
  );
}

function normalizeCreditRecord(record) {
  if (!record || typeof record !== "object") return null;
  const description = record.description || record.desc || record.reason || "";
  const amount = parseNumber(record.amount ?? record.change ?? record.credit);
  const balance = parseNumber(record.balance ?? record.current ?? record.after);
  const timestamp = record.created_at || record.createdAt || record.time || record.date || "";
  return { description, amount, balance, timestamp };
}

async function getCreditSummary() {
  const { response, data } = await fetchJson(`${BASE_URL}/api/account/credit/page-1`);
  if (!response.ok) return {};
  let records = data.credits || data.data || [];
  if (!Array.isArray(records) && records && typeof records === "object") {
    records = records.credits || records.data || [];
  }
  if (!Array.isArray(records)) return {};

  const normalized = records.map(normalizeCreditRecord).filter(Boolean);
  const signinRecords = normalized.filter((record) => String(record.description || "").includes("签到"));
  const latestBalance = normalized.find((record) => record.balance !== null)?.balance ?? null;
  const todayReward = signinRecords.find((record) => record.amount !== null)?.amount ?? null;
  const streakMatch = String(signinRecords[0]?.description || "").match(/连续签到\s*(\d+)\s*天/);

  return {
    todayReward,
    currentBalance: latestBalance,
    currentStreak: streakMatch ? Number(streakMatch[1]) : null,
  };
}

export async function runNodeSeek(context = {}) {
  const log = context.log || (async () => {});
  const pageResult = await runInActiveNodeSeekTab(context);
  if (pageResult) {
    return pageResult;
  }

  await log("当前页不可注入，使用后台请求 NodeSeek 签到接口");
  const { response, text, data } = await fetchJson(`${BASE_URL}/api/attendance?random=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const message = String(data.message || data.msg || "").trim();
  const bodyLooksHtml = /<html|<!doctype/i.test(text);

  if (!response.ok && !isAlreadyDone(message)) {
    if (response.status === 401 || response.status === 403) {
      return fail(`NodeSeek 签到接口返回 HTTP ${response.status}，请确认当前浏览器已登录并通过安全检查`);
    }
    if (bodyLooksHtml) {
      return fail(`NodeSeek 返回 HTML 页面，可能仍在安全检查中: HTTP ${response.status}`);
    }
    return fail(`NodeSeek 签到失败: HTTP ${response.status} ${compactText(text, 120)}`);
  }

  if (data.success !== true && !isAlreadyDone(message)) {
    return fail(message || `NodeSeek 签到失败: ${compactText(text, 120)}`);
  }

  await log("读取 NodeSeek 鸡腿记录");
  const summary = await getCreditSummary();
  const parts = [`结果: ${message || "签到完成"}`];
  if (summary.todayReward !== null && summary.todayReward !== undefined) {
    parts.push(`今日收益: ${summary.todayReward} 鸡腿`);
  }
  if (summary.currentBalance !== null && summary.currentBalance !== undefined) {
    parts.push(`当前鸡腿: ${summary.currentBalance}`);
  }
  if (summary.currentStreak !== null && summary.currentStreak !== undefined) {
    parts.push(`连续签到: ${summary.currentStreak} 天`);
  }
  return ok(parts.join("\n"));
}
