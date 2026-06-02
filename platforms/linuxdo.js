import { fail, ok } from "./utils.js";

const BASE_URL = "https://linux.do";
const CONNECT_URL = "https://connect.linux.do/";
const LINUXDO_TOPIC_SAMPLE_COUNT = 10;
const LINUXDO_LIKE_PROBABILITY = 0.3;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveLinuxDoTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) return null;

  try {
    const url = new URL(tab.url);
    if (url.hostname === "linux.do" || url.hostname.endsWith(".linux.do")) {
      return tab;
    }
  } catch {
    return null;
  }
  return null;
}

async function createBackgroundLinuxDoTab() {
  const tab = await chrome.tabs.create({ url: BASE_URL, active: false });
  if (!tab?.id) {
    throw new Error("创建 LinuxDo 后台标签页失败");
  }
  await waitForTabComplete(tab.id);
  return tab;
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (timeoutId) clearTimeout(timeoutId);
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      cleanup();
      resolve();
    };
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("等待 LinuxDo 主题页加载超时"));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function collectLinuxDoContext(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sampleCount) => {
      const randomize = (items) => {
        const copy = items.slice();
        for (let index = copy.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
        }
        return copy;
      };
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
        return { ok: response.ok, status: response.status, data, text };
      };
      const csrfFromMeta = document.querySelector('meta[name="csrf-token"]')?.content || "";
      const csrf = csrfFromMeta || await readJson("/session/csrf", {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }).then((result) => result.data.csrf || "");
      const session = await readJson("/session/current.json");
      const user = session.data.current_user || session.data.user || null;
      if (!session.ok || !user?.username) {
        return {
          success: false,
          detail: "未识别到 LinuxDo 登录态，请先在当前浏览器登录 linux.do",
        };
      }
      if (!csrf) {
        return {
          success: false,
          detail: "未获取到 LinuxDo CSRF token，无法提交阅读打点",
        };
      }
      const latest = await readJson("/latest.json");
      if (!latest.ok) {
        return {
          success: false,
          detail: `读取 LinuxDo 最新主题失败: HTTP ${latest.status}`,
        };
      }
      const topics = (latest.data.topic_list?.topics || [])
        .filter((topic) => topic?.id && topic?.slug)
        .slice(0, 30);
      return {
        success: true,
        username: user.username,
        csrf,
        topics: randomize(topics).slice(0, Math.min(sampleCount, topics.length)).map((topic) => ({
          id: topic.id,
          slug: topic.slug,
          title: topic.title || `/t/${topic.slug}/${topic.id}`,
        })),
        totalCandidates: topics.length,
      };
      },
      args: [LINUXDO_TOPIC_SAMPLE_COUNT],
    });
    return injection?.result || {
      success: false,
      detail: "LinuxDo 后台标签页采集未返回结果",
    };
  } catch (error) {
    return {
      success: false,
      detail: `LinuxDo 后台标签页采集失败: ${error?.message || String(error)}`,
    };
  }
}

async function browseTopicInTab(tabId, topic, index, total, csrf) {
  const url = `${BASE_URL}/t/${topic.slug}/${topic.id}`;
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (topicArg, indexArg, totalArg, csrfArg, likeProbability) => {
      const progress = async (detail) => {
        try {
          await chrome.runtime.sendMessage({ type: "linuxdo-progress", detail });
        } catch {
          // Best-effort progress update.
        }
      };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const randomInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
      const clean = (value) => String(value || "").trim();
      const resolvePostId = (node) => {
        let current = node;
        while (current && current !== document.documentElement) {
          const direct = clean(current.getAttribute && current.getAttribute("data-post-id"));
          if (direct) return direct;
          const datasetPostId = clean(current.dataset && current.dataset.postId);
          if (datasetPostId) return datasetPostId;
          const idMatch = clean(current.id).match(/^post_(\d+)$/);
          if (idMatch) return idMatch[1];
          const reactionMatch = clean(current.id).match(/^discourse-reactions-(?:actions|counter|list-emoji)-(\d+)(?:-.+)?$/);
          if (reactionMatch) return reactionMatch[1];
          current = current.parentElement;
        }
        const firstPost = document.querySelector("article[data-post-id], [data-post-id], article[id^='post_']");
        if (!firstPost) return "";
        return (
          clean(firstPost.getAttribute("data-post-id")) ||
          clean(firstPost.dataset && firstPost.dataset.postId) ||
          (clean(firstPost.id).match(/^post_(\d+)$/) || [])[1] ||
          ""
        );
      };
      const verifyLiked = async (postId) => {
        if (!postId) return false;
        try {
          const response = await fetch(`/posts/${postId}.json`, {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json, text/plain, */*" },
          });
          if (!response.ok) return false;
          const data = await response.json();
          const actions = Array.isArray(data.actions_summary) ? data.actions_summary : [];
          return actions.some((action) => Number(action.id) === 2 && action.acted === true);
        } catch {
          return false;
        }
      };
      const likeByApi = async (postId, csrfToken) => {
        if (!postId) return { ok: false, status: 0, detail: "缺少 post_id" };
        try {
          const response = await fetch("/post_actions.json", {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json, text/plain, */*",
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify({
              id: Number(postId),
              post_action_type_id: 2,
            }),
          });
          const text = await response.text();
          return {
            ok: response.ok,
            status: response.status,
            detail: text.replace(/\s+/g, " ").trim().slice(0, 120),
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            detail: error?.message || String(error),
          };
        }
      };
      const tryLike = async (phase) => {
        likeTried = true;
        likeDetail = `${phase}: 已尝试`;
        const buttons = Array.from(document.querySelectorAll([
          "button.btn-toggle-reaction-like.reaction-button",
          ".discourse-reactions-actions button.btn-toggle-reaction-like.reaction-button",
          "button[title*='点赞']",
          "button[aria-label*='点赞']",
          "button[title*='赞']",
          "button[aria-label*='赞']",
          "button.toggle-like",
          ".post-controls button",
          ".actions button",
        ].join(",")));
        await progress(`点赞检查 ${indexArg + 1}/${totalArg} (${phase}): 发现 ${buttons.length} 个候选按钮`);
        const button = buttons.find((candidate) => {
          const use = candidate.querySelector("use");
          const text = candidate.textContent || "";
          const summary = [
            candidate.getAttribute("title"),
            candidate.getAttribute("aria-label"),
            candidate.className,
            text,
            use ? use.getAttribute("href") : "",
          ].map(clean).join(" ");
          const alreadyLiked = (
            summary.includes("移除") ||
            summary.includes("取消") ||
            summary.includes("撤销") ||
            summary.includes("已赞") ||
            summary.includes("#heart")
          ) && !summary.includes("#far-heart");
          return !alreadyLiked && (
            summary.includes("点赞") ||
            summary.includes("赞") ||
            summary.includes("#far-heart") ||
            summary.includes("d-unliked") ||
            summary.includes("like")
          );
        });
        if (button) {
          likeFound = true;
          likePostId = resolvePostId(button);
          likeDetail = `${phase}: 找到按钮，已点击`;
          button.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
          button.click();
          await wait(randomInt(1800, 3200));
          const use = button.querySelector("use");
          const state = [
            button.getAttribute("title"),
            button.getAttribute("aria-label"),
            button.className,
            button.textContent || "",
            use ? use.getAttribute("href") : "",
          ].map(clean).join(" ");
          liked = (
            state.includes("移除") ||
            state.includes("取消") ||
            state.includes("撤销") ||
            state.includes("已赞") ||
            state.includes("#heart")
          ) && !state.includes("#far-heart");
          likeDetail = liked ? `${phase}: 点击后确认已赞` : `${phase}: 点击后未确认: ${state.slice(0, 80)}`;
        } else {
          likeDetail = `${phase}: 未找到可点赞按钮`;
          likePostId = resolvePostId(document.body);
        }

        if (!liked && likePostId) {
          await progress(`点赞 API 兜底 ${indexArg + 1}/${totalArg} (${phase}): post_id=${likePostId}`);
          const apiResult = await likeByApi(likePostId, csrfArg);
          await wait(1000);
          if (apiResult.ok) {
            liked = await verifyLiked(likePostId);
            likeDetail = liked
              ? `${phase}: API 点赞成功: HTTP ${apiResult.status}`
              : `${phase}: API 返回成功但未验证已赞: HTTP ${apiResult.status}`;
          } else if (apiResult.status === 403 && apiResult.detail.includes("already performed this action")) {
            liked = true;
            likeDetail = `${phase}: 已点赞`;
          } else {
            liked = false;
            likeDetail = `${phase}: API 点赞失败: HTTP ${apiResult.status} ${apiResult.detail}`;
          }
        }
        await progress(`点赞结果 ${indexArg + 1}/${totalArg}: ${likeDetail}`);
        return liked;
      };
      const startedAt = performance.now();
      let scrolls = 0;
      let exitReason = "max_scrolls";
      let previousUrl = "";
      const shouldLike = Math.random() < likeProbability;
      const likeAtScroll = randomInt(2, 8);
      let likeAttemptedDuringScroll = false;
      let liked = false;
      let likeTried = false;
      let likeFound = false;
      let likeDetail = shouldLike ? `计划在第 ${likeAtScroll} 次滚动附近点赞` : "未尝试";
      let likePostId = "";

      await progress(`打开主题 ${indexArg + 1}/${totalArg}: ${topicArg.title}`);
      for (let step = 0; step < 10; step += 1) {
        window.scrollBy(0, randomInt(550, 650));
        scrolls += 1;
        await progress(`滚动主题 ${indexArg + 1}/${totalArg}: ${scrolls}/10`);

        if (shouldLike && !likeAttemptedDuringScroll && scrolls >= likeAtScroll) {
          likeAttemptedDuringScroll = true;
          await tryLike("滚动中");
        }

        if (Math.random() < 0.03) {
          exitReason = "random_exit";
          break;
        }

        const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight;
        const currentUrl = location.href;
        if (currentUrl === previousUrl && atBottom) {
          exitReason = "bottom";
          break;
        }
        previousUrl = currentUrl;
        await wait(randomInt(2000, 4000));
      }

      if (shouldLike && !liked && !likeAttemptedDuringScroll) {
        await tryLike("收尾兜底");
      }

      const durationMs = Math.max(1000, Math.round(performance.now() - startedAt));
      const postNumbers = Array.from(document.querySelectorAll("[data-post-number], article[id^='post_']"))
        .map((node) => {
          const direct = Number(node.getAttribute("data-post-number"));
          if (Number.isFinite(direct) && direct > 0) return direct;
          const match = String(node.id || "").match(/^post_(\d+)$/);
          return match ? Number(match[1]) : NaN;
        })
        .filter((value) => Number.isFinite(value) && value > 0);
      const effectivePostNumbers = Array.from(new Set(postNumbers)).slice(0, 6);
      const payload = new URLSearchParams();
      for (const postNumber of effectivePostNumbers.length ? effectivePostNumbers : [1]) {
        payload.append(`timings[${postNumber}]`, String(durationMs));
      }
      payload.append("topic_time", String(durationMs));
      payload.append("topic_id", String(topicArg.id));

      const timingResponse = await fetch("/topics/timings", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "*/*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Discourse-Background": "true",
          "Discourse-Logged-In": "true",
          "Discourse-Present": "true",
          "X-CSRF-Token": csrfArg,
          "X-Requested-With": "XMLHttpRequest",
          "X-Silence-Logger": "true",
        },
        body: payload.toString(),
      });

      return {
        ok: timingResponse.ok,
        status: timingResponse.status,
        title: topicArg.title,
        durationMs,
        scrolls,
        exitReason,
        likeTried,
        likeFound,
        likeDetail,
        likePostId,
        liked,
      };
    },
    args: [topic, index, total, csrf, LINUXDO_LIKE_PROBABILITY],
  });

  return injection?.result || {
    ok: false,
    status: 0,
    title: topic.title,
    durationMs: 0,
    scrolls: 0,
    exitReason: "unknown",
    likeTried: false,
    likeFound: false,
    likeDetail: "未知",
    likePostId: "",
    liked: false,
  };
}

async function fetchConnectSummaryInTab(tabId) {
  await chrome.tabs.update(tabId, { url: CONNECT_URL });
  try {
    await waitForTabComplete(tabId, 60000);
  } catch {
    // Connect may finish SSO through client-side routing; still try to parse.
  }
  await wait(3000);
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const metrics = [];
      const appendMetric = (name, current, required) => {
        const label = clean(name);
        const now = clean(current);
        const need = clean(required);
        if (!label || !now && !need) return;
        metrics.push(need ? `${label}: ${now}/${need}` : `${label}: ${now}`);
      };

      for (const row of document.querySelectorAll("table tr")) {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) => clean(cell.textContent));
        if (cells.length >= 3) appendMetric(cells[0], cells[1] || "0", cells[2] || "0");
      }

      for (const item of document.querySelectorAll(".tl3-ring")) {
        const label = clean(item.querySelector(".tl3-ring-label")?.textContent);
        const value = clean(item.querySelector(".tl3-ring-circle")?.textContent);
        const match = value.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
        if (label && match) appendMetric(label, match[1], match[2]);
      }

      for (const item of document.querySelectorAll(".tl3-bar-item")) {
        const text = clean(item.querySelector(".tl3-bar-header")?.textContent || item.textContent);
        const match = text.match(/(.+?)\s+(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
        if (match) appendMetric(match[1], match[2], match[3]);
      }

      for (const item of document.querySelectorAll(".tl3-record-item")) {
        const label = clean(item.querySelector(".tl3-record-label")?.textContent);
        const value = clean(item.querySelector(".tl3-record-value")?.textContent);
        const match = value.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
        if (label && match) appendMetric(label, match[1], match[2]);
      }

      const username = clean(document.querySelector("[class*='username'], [href*='Jacky'], .user-name")?.textContent);
      const trustLevel = clean(document.body.textContent).match(/信任级别\s*([0-9]+)/)?.[1] || "";
      const reached = clean(document.body.textContent).includes("已达到");
      return {
        url: location.href,
        username,
        trustLevel,
        reached,
        metrics: Array.from(new Set(metrics)).slice(0, 8),
      };
    },
  });
  const result = injection?.result || {};
  const parts = [];
  if (result.trustLevel) parts.push(`信任级别: ${result.trustLevel}`);
  if (typeof result.reached === "boolean") parts.push(`升级要求: ${result.reached ? "已达到" : "未确认"}`);
  if (Array.isArray(result.metrics) && result.metrics.length) {
    parts.push(...result.metrics);
  }
  return parts.join("\n");
}

async function runInActiveLinuxDoTab(log) {
  await log("查找当前 LinuxDo 标签页");
  const tab = await getActiveLinuxDoTab();
  if (!tab) return null;

  await log("创建 LinuxDo 后台标签页");
  const workTab = await createBackgroundLinuxDoTab();
  try {
    await log("后台标签页校验登录态并采集主题列表");
    const context = await collectLinuxDoContext(workTab.id);
    if (!context?.success) return context;

    await log(`已确认登录: ${context.username}`);
    await log(`发现 ${context.totalCandidates} 个候选主题，计划浏览 ${context.topics.length} 个`);

    const results = [];
    for (const [index, topic] of context.topics.entries()) {
      const result = await browseTopicInTab(workTab.id, topic, index, context.topics.length, context.csrf);
      results.push(result);
      await log(
        `主题完成 ${index + 1}/${context.topics.length}: HTTP ${result.status}, ` +
        `滚动 ${result.scrolls} 次, 点赞=${result.liked ? "是" : result.likeDetail || "未尝试"}`
      );
    }

    const completed = results.filter((item) => item.ok).length;
    const likes = results.filter((item) => item.liked).length;
    await log("后台读取 LinuxDo Connect 信息");
    const connectSummary = await fetchConnectSummaryInTab(workTab.id);
    return {
      success: completed > 0,
      detail: [
        `账号: ${context.username}`,
        "登录确认: 已登录",
        `浏览摘要: ${completed}/${context.topics.length} 个主题`,
        `点赞: ${likes} 次`,
        `主题: ${results.slice(0, 5).map((item) => item.title).join(" / ")}`,
        connectSummary ? `Connect:\n${connectSummary}` : "Connect: 未获取到有效数据",
      ].join("\n"),
    };
  } finally {
    await log("关闭 LinuxDo 后台标签页");
    try {
      await chrome.tabs.remove(workTab.id);
    } catch {
      // The tab may already be closed by the user.
    }
  }
}

export async function runLinuxDo(context = {}) {
  const log = context.log || (async () => {});
  const result = await runInActiveLinuxDoTab(log);
  if (!result) {
    return fail("未找到可执行的 LinuxDo 页面，请先切换到 linux.do");
  }
  if (!result.success) {
    return fail(result.detail || "LinuxDo 任务失败");
  }

  return ok(result.detail);
}
