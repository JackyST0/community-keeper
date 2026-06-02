export function ok(detail) {
  return { success: true, detail };
}

export function fail(detail) {
  return { success: false, detail };
}

export function skipped(detail) {
  return { success: false, skipped: true, detail };
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { response, text };
}

export async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, {
    ...options,
    headers: {
      Accept: "application/json, text/plain, */*",
      ...(options.headers || {}),
    },
  });
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { response, text, data };
}

export function compactText(value, limit = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function stripTags(html) {
  return compactText(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, "\"")
  );
}

export function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

export function parseNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

export function todayKey() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}
