import { absoluteUrl, compactText, fail, fetchText, ok, stripTags } from "./utils.js";

const BASE_URL = "https://forum.naixi.net/";
const SIGN_PAGE_URL = "https://forum.naixi.net/k_misign-sign.html";

function parseInput(html, id) {
  const match = String(html || "").match(new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)["']`, "i"));
  return compactText(match?.[1] || "", 80);
}

function parseSignHref(html) {
  const match = String(html || "").match(/<a\s+id=["']JD_sign["'][^>]+href=["']([^"']+)["']/i);
  return match?.[1] || "";
}

function parseAuthor(html) {
  const matches = String(html || "").matchAll(
    /<a\b[^>]*class=["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
  );
  for (const item of matches) {
    const value = stripTags(item[1] || "");
    if (value && !value.includes("{{")) return value;
  }
  return "";
}

function parseFontMessage(html) {
  const match = String(html || "").match(/<div\s+class=["']font["'][^>]*>([\s\S]*?)<\/div>/i);
  return match ? stripTags(match[1]) : "";
}

function parseSummary(html) {
  return {
    username: parseAuthor(html),
    rank: parseInput(html, "qiandaobtnnum"),
    continuousDays: parseInput(html, "lxdays"),
    level: parseInput(html, "lxlevel"),
    reward: parseInput(html, "lxreward"),
    totalDays: parseInput(html, "lxtdays"),
    message: parseFontMessage(html),
    signed: String(html || "").includes("今日已签") || String(html || "").includes("您的签到排名"),
    notSigned: String(html || "").includes("您今天还没有签到"),
    signHref: parseSignHref(html),
  };
}

function formatSummary(summary, statusText) {
  const parts = [];
  if (statusText) parts.push(`状态: ${statusText}`);
  if (summary.username) parts.push(`账号: ${summary.username}`);
  if (summary.rank) parts.push(`排名: ${summary.rank}`);
  if (summary.continuousDays) parts.push(`连续签到: ${summary.continuousDays} 天`);
  if (summary.level) parts.push(`签到等级: ${summary.level}`);
  if (summary.reward) parts.push(`积分奖励: ${summary.reward}`);
  if (summary.totalDays) parts.push(`总天数: ${summary.totalDays} 天`);
  if (summary.message) parts.push(`详情: ${summary.message}`);
  return parts.join("\n") || "签到完成";
}

export async function runNaixi(context = {}) {
  const log = context.log || (async () => {});
  await log("打开奶昔签到页");
  let page = await fetchText(SIGN_PAGE_URL, {
    headers: { Referer: BASE_URL },
  });
  if (!page.response.ok) {
    return fail(`打开奶昔签到页失败: HTTP ${page.response.status}`);
  }

  let summary = parseSummary(page.text);
  await log(summary.signed ? "页面显示今日已签到" : "页面显示今日未签到");
  if (!summary.username) {
    return fail("未识别到奶昔登录态，请先在当前浏览器登录 forum.naixi.net 并通过安全检查");
  }

  const wasSignedBefore = summary.signed;
  if (!summary.signed) {
    if (!summary.signHref || summary.signHref.includes("member.php?mod=logging")) {
      return fail("未找到有效签到链接");
    }
    await log("提交奶昔签到请求");
    const signUrl = absoluteUrl(BASE_URL, summary.signHref);
    const sign = await fetchText(signUrl, {
      headers: {
        Referer: SIGN_PAGE_URL,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!sign.response.ok) {
      return fail(`奶昔签到接口返回 HTTP ${sign.response.status}`);
    }

    await log("重新读取奶昔签到结果");
    page = await fetchText(SIGN_PAGE_URL, {
      headers: { Referer: SIGN_PAGE_URL },
    });
    summary = parseSummary(page.text);
  }

  if (!summary.signed) {
    return fail(formatSummary(summary, "签到后未确认成功") || "签到后未确认成功");
  }

  return ok(formatSummary(summary, wasSignedBefore ? "今日已签到" : "签到完成"));
}
