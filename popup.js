const platformButtons = [...document.querySelectorAll("[data-platform]")];
const resultOutput = document.querySelector("#resultOutput");
const statusText = document.querySelector("#statusText");
const refreshButton = document.querySelector("#refreshButton");
const clearButton = document.querySelector("#clearButton");
let refreshTimer = 0;
let lastRenderedLogs = "";

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
  statusText.textContent = "任务执行中";
  setButtonState(platformId, "running");
  startLiveRefresh();
  try {
    renderState(await sendMessage({ type: "run-platform", platformId }));
  } finally {
    window.setTimeout(refreshAndManageTimer, 250);
  }
}

for (const button of platformButtons) {
  button.addEventListener("click", () => runPlatform(button.dataset.platform));
}

refreshButton.addEventListener("click", async () => {
  await sendMessage({ type: "reset-panel" });
  lastRenderedLogs = "";
  await refreshState();
});

clearButton.addEventListener("click", async () => {
  await sendMessage({ type: "clear-logs" });
  lastRenderedLogs = "";
  await refreshState();
});

window.addEventListener("focus", refreshAndManageTimer);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshAndManageTimer();
  }
});

refreshAndManageTimer();
