import { absoluteUrl, compactText, fail, fetchText, ok, parseNumber, todayKey } from "./utils.js";

const HOME_URL = "https://www.v2ex.com/";
const MISSION_URL = "https://www.v2ex.com/mission/daily";
const BALANCE_URL = "https://www.v2ex.com/balance";

function extractUsername(html) {
  const match = String(html || "").match(/href=["']\/member\/([^"']+)["'][^>]*>([^<]*)</i);
  if (!match) return "unknown";
  return compactText(match[2] || match[1] || "unknown", 60).replace(/^@/, "") || "unknown";
}

function extractRedeemUrl(html) {
  const patterns = [
    /location\.href\s*=\s*['"]([^'"]*\/mission\/daily\/redeem\?once=[^'"]+)['"]/i,
    /(\/mission\/daily\/redeem\?once=[^'"<>\s]+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match) return absoluteUrl(HOME_URL, match[1]);
  }
  return "";
}

function parseMissionPage(html, pageUrl) {
  const text = compactText(html, 600).toLowerCase();
  if (String(pageUrl || "").includes("/signin") || text.includes("请先登录") || text.includes("signin")) {
    return { status: "auth_required", detail: "当前浏览器没有 V2EX 登录态" };
  }
  if (text.includes("captcha") || text.includes("验证码") || text.includes("你是机器人吗")) {
    return { status: "blocked", detail: "V2EX 返回验证页面，需要手动处理" };
  }

  const redeemUrl = extractRedeemUrl(html);
  if (redeemUrl) {
    return { status: "claimable", detail: "找到领取入口", redeemUrl };
  }

  const alreadyMarkers = [
    "每日登录奖励已领取",
    "今日登录奖励已领取",
    "今日奖励已经领取",
    "查看我的账户余额",
    "/balance",
  ];
  if (alreadyMarkers.some((marker) => String(html || "").includes(marker))) {
    return { status: "already_done", detail: "今日奖励已领取" };
  }

  return { status: "unknown", detail: compactText(html) || "无法解析 V2EX 任务页面" };
}

function extractCurrencyBreakdown(html) {
  const labels = [
    ["G", "金币"],
    ["S", "银币"],
    ["B", "铜币"],
  ];
  const parts = [];
  for (const [alt, label] of labels) {
    const match = String(html || "").match(new RegExp(`(\\d[\\d,]*)\\s*<img[^>]+alt=["']${alt}["']`, "i"));
    if (match) {
      parts.push(`${Number(match[1].replace(/,/g, ""))} ${label}`);
    }
  }
  return parts.join(" ");
}

function htmlCellText(html) {
  return compactText(
    String(html || "")
      .replace(/<img[^>]+alt=["']G["'][^>]*>/gi, " 金币 ")
      .replace(/<img[^>]+alt=["']S["'][^>]*>/gi, " 银币 ")
      .replace(/<img[^>]+alt=["']B["'][^>]*>/gi, " 铜币 ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
  );
}

function parseRewardFromBalanceRows(html) {
  const rows = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    if (!row.includes(todayKey())) continue;
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (!cells.length) continue;
    const lastCellText = htmlCellText(cells[cells.length - 1]);
    const numbers = lastCellText.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/g) || [];
    const reward = numbers.length ? Number(numbers[numbers.length - 1]) : null;
    if (reward !== null && reward !== undefined) return reward;
  }
  return null;
}

async function getBalanceSummary() {
  const { response, text } = await fetchText(BALANCE_URL, {
    headers: { Referer: MISSION_URL },
  });
  if (!response.ok || response.url.includes("/signin")) return {};

  const username = extractUsername(text);
  let currentBalance = "";
  const balanceMatch = text.match(/class=["'][^"']*balance_area[^"']*["'][^>]*>[\s\S]*?<\/(?:a|div)>/i);
  if (balanceMatch) {
    currentBalance = extractCurrencyBreakdown(balanceMatch[0]);
  }

  const todayReward = parseRewardFromBalanceRows(text);

  return { username, currentBalance, todayReward };
}

export async function runV2EX(context = {}) {
  const log = context.log || (async () => {});
  await log("打开 V2EX 每日任务页");
  const mission = await fetchText(MISSION_URL, {
    headers: { Referer: HOME_URL },
  });
  if (!mission.response.ok) {
    return fail(`打开 V2EX 任务页失败: HTTP ${mission.response.status}`);
  }

  let status = parseMissionPage(mission.text, mission.response.url);
  await log(`任务页状态: ${status.detail}`);
  if (status.status === "auth_required" || status.status === "blocked") {
    return fail(status.detail);
  }

  if (status.status === "claimable") {
    await log("提交 V2EX 奖励领取请求");
    const claim = await fetchText(status.redeemUrl, {
      headers: { Referer: MISSION_URL },
    });
    if (!claim.response.ok) {
      return fail(`领取 V2EX 奖励失败: HTTP ${claim.response.status}`);
    }
    await log("重新检查 V2EX 领取状态");
    const verify = await fetchText(MISSION_URL, {
      headers: { Referer: MISSION_URL },
    });
    status = parseMissionPage(verify.text, verify.response.url);
    if (status.status !== "already_done") {
      return fail(`领取后未能确认成功: ${status.detail}`);
    }
  } else if (status.status !== "already_done") {
    return fail(`未找到 V2EX 领取入口: ${status.detail}`);
  }

  await log("读取 V2EX 余额信息");
  const summary = await getBalanceSummary();
  const parts = [`账号: ${summary.username || extractUsername(mission.text)}`, "结果: 今日奖励已领取"];
  if (summary.todayReward !== null && summary.todayReward !== undefined) {
    parts.push(`今日获得: ${summary.todayReward} 铜币`);
  }
  if (summary.currentBalance) {
    parts.push(`当前余额: ${summary.currentBalance}`);
  }
  return ok(parts.join("\n"));
}
