const runnerPlatforms = document.querySelector("#runnerPlatforms");
const runnerLogOutput = document.querySelector("#runnerLogOutput");
const runnerStatus = document.querySelector("#runnerStatus");
const copyRunnerLogButton = document.querySelector("#copyRunnerLogButton");
const projectRunnerButton = document.querySelector("#projectRunnerButton");
const closeRunnerButton = document.querySelector("#closeRunnerButton");
const runnerVersionText = document.querySelector("#runnerVersionText");

const platformMeta = {
  v2ex: {
    name: "V2EX",
    description: "每日登录奖励",
    icon: "icons/platforms/v2ex.png",
  },
  nodeseek: {
    name: "NodeSeek",
    description: "每日签到",
    icon: "icons/platforms/nodeseek.png",
  },
  linuxdo: {
    name: "LinuxDo",
    description: "登录校验和浏览",
    icon: "icons/platforms/linuxdo.png",
  },
  naixi: {
    name: "奶昔论坛",
    description: "每日签到",
    icon: "icons/platforms/naixi.png",
  },
};

const stateLabels = {
  idle: "待执行",
  running: "执行中",
  success: "成功",
  error: "失败",
  skipped: "跳过",
};

let selectedPlatformIds = [];
let refreshTimer = 0;
let copyFeedbackTimer = 0;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (response?.error) {
      throw new Error(response.error);
    }
    return response;
  });
}

function getSelectedPlatformIds() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("platforms") || "";
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return values.filter((platformId) => platformMeta[platformId]);
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

function renderPlatformShell() {
  document.body.dataset.platformCount = String(selectedPlatformIds.length);
  runnerPlatforms.innerHTML = selectedPlatformIds
    .map((platformId) => {
      const meta = platformMeta[platformId];
      return `
        <article class="runner-platform" data-runner-platform="${platformId}">
          <div class="runner-platform-info">
            <img src="${meta.icon}" alt="" aria-hidden="true">
            <span>
              <strong>${meta.name}</strong>
              <small>${meta.description}</small>
            </span>
          </div>
          <span class="runner-state" data-runner-state="${platformId}">待执行</span>
        </article>
      `;
    })
    .join("");
}

function renderState(state) {
  const runs = state?.runs || {};
  const logs = state?.logs || [];
  const running = Object.values(runs).some((item) => item?.status === "running");

  for (const platformId of selectedPlatformIds) {
    const item = runs[platformId] || {};
    const status = item.status || "idle";
    const stateEl = document.querySelector(`[data-runner-state="${platformId}"]`);
    if (!stateEl) continue;
    stateEl.className = "runner-state";
    if (status !== "idle") {
      stateEl.classList.add(status);
    }
    stateEl.textContent = stateLabels[status] || status;
  }

  runnerStatus.textContent = running ? "正在顺序执行" : "执行结束";

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

  runnerLogOutput.textContent = renderedLogs;
  runnerLogOutput.scrollTop = runnerLogOutput.scrollHeight;

  if (!running) {
    stopRefresh();
  }
}

async function refreshState() {
  const state = await sendMessage({ type: "get-state" });
  renderState(state);
}

function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = window.setInterval(refreshState, 700);
}

function stopRefresh() {
  if (!refreshTimer) return;
  window.clearInterval(refreshTimer);
  refreshTimer = 0;
}

async function resizeRunnerWindow() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    const contentHeight = Math.ceil(document.documentElement.scrollHeight);
    const chromeFrameOffset = Math.max(0, (currentWindow.height || window.outerHeight) - window.innerHeight);
    const nextHeight = Math.min(760, Math.max(430, contentHeight + chromeFrameOffset + 2));
    if (Math.abs((currentWindow.height || 0) - nextHeight) > 12) {
      await chrome.windows.update(currentWindow.id, { height: nextHeight });
    }
  } catch {
    // Window resizing is best effort; the runner still works if the browser blocks it.
  }
}

function setCopyButtonText(text) {
  copyRunnerLogButton.textContent = text;
  if (copyFeedbackTimer) {
    window.clearTimeout(copyFeedbackTimer);
  }
  copyFeedbackTimer = window.setTimeout(() => {
    copyRunnerLogButton.textContent = "复制";
    copyFeedbackTimer = 0;
  }, 1200);
}

async function copyLog() {
  const text = runnerLogOutput.textContent.trim();
  if (!text || text === "暂无记录" || text === "准备执行...") {
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

async function runSelectedPlatforms() {
  if (!selectedPlatformIds.length) {
    runnerStatus.textContent = "未选择平台";
    runnerLogOutput.textContent = "请返回弹窗至少选择一个平台。";
    return;
  }

  renderPlatformShell();
  runnerStatus.textContent = "开始执行";
  startRefresh();

  try {
    renderState(await sendMessage({ type: "run-all-platforms", platformIds: selectedPlatformIds }));
  } catch (error) {
    runnerStatus.textContent = "执行失败";
    runnerLogOutput.textContent = error?.message || String(error);
  } finally {
    await resizeRunnerWindow();
    window.setTimeout(refreshState, 300);
  }
}

copyRunnerLogButton.addEventListener("click", copyLog);
projectRunnerButton.addEventListener("click", () => sendMessage({ type: "open-project" }));
closeRunnerButton.addEventListener("click", () => window.close());

if (runnerVersionText) {
  runnerVersionText.textContent = `版本 v${chrome.runtime.getManifest().version}`;
}

selectedPlatformIds = getSelectedPlatformIds();
runSelectedPlatforms();
window.setTimeout(resizeRunnerWindow, 100);
