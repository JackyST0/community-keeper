const platformButtons = [...document.querySelectorAll("[data-platform]")];
const platformCards = [...document.querySelectorAll("[data-platform-card]")];
const openButtons = [...document.querySelectorAll("[data-open-platform]")];
const resultOutput = document.querySelector("#resultOutput");
const statusText = document.querySelector("#statusText");
const currentSiteText = document.querySelector("#currentSiteText");
const refreshButton = document.querySelector("#refreshButton");
const copyButton = document.querySelector("#copyButton");
const clearButton = document.querySelector("#clearButton");
const versionText = document.querySelector("#versionText");
let refreshTimer = 0;
let lastRenderedLogs = "";
let currentPlatformId = "";
let copyFeedbackTimer = 0;

const stateLabels = {
  idle: "待执行",
  running: "执行中",
  success: "成功",
  error: "失败",
  skipped: "跳过",
};

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function formatTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function setButtonState(platformId, status) {
  const state = document.querySelector(`[data-state-for="${platformId}"]`);
  if (!state) return;
  state.className = "button-state";
  if (status && status !== "idle") {
    state.classList.add(status);
  }
  state.textContent = stateLabels[status] || stateLabels.idle;
}

function applyCurrentPlatform() {
  for (const card of platformCards) {
    card.dataset.current = card.dataset.platformCard === currentPlatformId ? "true" : "";
  }
}

function setCopyButtonText(text) {
  copyButton.textContent = text;
  if (copyFeedbackTimer) {
    window.clearTimeout(copyFeedbackTimer);
  }
  copyFeedbackTimer = window.setTimeout(() => {
    copyButton.textContent = "复制";
    copyFeedbackTimer = 0;
  }, 1200);
}

function renderState(state) {
  const runs = state?.runs || {};
  const logs = state?.logs || [];
  let running = false;
  let runningPlatformId = "";

  for (const [platformId, item] of Object.entries(runs)) {
    if (item?.status === "running") {
      running = true;
      runningPlatformId = platformId;
      break;
    }
  }

  for (const button of platformButtons) {
    const platformId = button.dataset.platform;
    const item = runs[platformId] || {};
    const status = item.status || "idle";
    button.disabled = running;
    button.dataset.lockState = running
      ? platformId === runningPlatformId
        ? "running"
        : "blocked"
      : "";
    setButtonState(platformId, status);
  }
  applyCurrentPlatform();

  statusText.textContent = running ? "任务执行中" : "准备执行";

  const renderedLogs = logs.length
    ? logs
      .slice()
      .reverse()
      .map((entry) => {
        const time = formatTime(entry.finishedAt || entry.startedAt);
        const detail = entry.detail ? `\n${entry.detail}` : "";
        return `[${time}] ${entry.name}: ${stateLabels[entry.status] || entry.status}${detail}`;
      })
      .join("\n\n")
    : "暂无记录";

  if (renderedLogs !== lastRenderedLogs) {
    resultOutput.textContent = renderedLogs;
    resultOutput.scrollTop = resultOutput.scrollHeight;
    lastRenderedLogs = renderedLogs;
  }
}

async function copyResult() {
  const text = resultOutput.textContent.trim();
  if (!text || text === "暂无记录") {
    setCopyButtonText("无内容");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setCopyButtonText("已复制");
  } catch {
    setCopyButtonText("复制失败");
  }
}

async function refreshActivePlatform() {
  const activePlatform = await sendMessage({ type: "get-active-platform" });
  currentPlatformId = activePlatform?.supported ? activePlatform.platformId : "";
  currentSiteText.textContent = activePlatform?.detail || "当前页面暂不支持";
  currentSiteText.dataset.supported = activePlatform?.supported ? "true" : "false";
  applyCurrentPlatform();
  return activePlatform;
}

async function refreshState() {
  const state = await sendMessage({ type: "get-state" });
  renderState(state);
  return state;
}

function startLiveRefresh() {
  if (refreshTimer) return;
  refreshTimer = window.setInterval(refreshState, 500);
}

function stopLiveRefresh() {
  if (!refreshTimer) return;
  window.clearInterval(refreshTimer);
  refreshTimer = 0;
}

function shouldKeepRefreshing(state) {
  const runs = state?.runs || {};
  return Object.values(runs).some((item) => item?.status === "running");
}

async function refreshAndManageTimer() {
  const state = await refreshState();
  if (shouldKeepRefreshing(state)) {
    startLiveRefresh();
    return;
  }
  stopLiveRefresh();
}

async function runPlatform(platformId) {
  for (const button of platformButtons) {
    button.disabled = true;
  }
  for (const button of openButtons) {
    button.disabled = true;
  }
  statusText.textContent = "任务执行中";
  setButtonState(platformId, "running");
  startLiveRefresh();
  try {
    renderState(await sendMessage({ type: "run-platform", platformId }));
  } finally {
    for (const button of openButtons) {
      button.disabled = false;
    }
    window.setTimeout(refreshAndManageTimer, 250);
  }
}

async function openPlatform(platformId) {
  await sendMessage({ type: "open-platform", platformId });
}

for (const button of platformButtons) {
  button.addEventListener("click", () => runPlatform(button.dataset.platform));
}

for (const button of openButtons) {
  button.addEventListener("click", () => openPlatform(button.dataset.openPlatform));
}

refreshButton.addEventListener("click", async () => {
  await sendMessage({ type: "reset-panel" });
  lastRenderedLogs = "";
  await refreshActivePlatform();
  await refreshState();
});

clearButton.addEventListener("click", async () => {
  await sendMessage({ type: "clear-logs" });
  lastRenderedLogs = "";
  await refreshState();
});

copyButton.addEventListener("click", copyResult);

versionText.textContent = `版本 v${chrome.runtime.getManifest().version}`;

window.addEventListener("focus", async () => {
  await refreshActivePlatform();
  await refreshAndManageTimer();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshActivePlatform().finally(refreshAndManageTimer);
  }
});

refreshActivePlatform().finally(refreshAndManageTimer);
