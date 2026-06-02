import { runLinuxDo } from "./platforms/linuxdo.js";
import { runNodeSeek } from "./platforms/nodeseek.js";
import { runNaixi } from "./platforms/naixi.js";
import { runV2EX } from "./platforms/v2ex.js";

const STORAGE_KEY = "communityKeeperState";
const MAX_LOGS = 60;
const PROJECT_URL = "https://github.com/JackyST0/community-keeper";

const platforms = {
  linuxdo: {
    name: "LinuxDo",
    run: runLinuxDo,
    hosts: ["linux.do"],
    homeUrl: "https://linux.do/",
    hint: "请先切换到 linux.do 页面",
  },
  nodeseek: {
    name: "NodeSeek",
    run: runNodeSeek,
    hosts: ["nodeseek.com", "www.nodeseek.com"],
    homeUrl: "https://www.nodeseek.com/",
    hint: "请先切换到 nodeseek.com 页面",
  },
  naixi: {
    name: "奶昔论坛",
    run: runNaixi,
    hosts: ["forum.naixi.net"],
    homeUrl: "https://forum.naixi.net/",
    hint: "请先切换到 forum.naixi.net 页面",
  },
  v2ex: {
    name: "V2EX",
    run: runV2EX,
    hosts: ["v2ex.com", "www.v2ex.com"],
    homeUrl: "https://www.v2ex.com/",
    hint: "请先切换到 v2ex.com 页面",
  },
};
const PLATFORM_ORDER = ["v2ex", "nodeseek", "linuxdo", "naixi"];

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url || "";
}

function hostnameMatches(hostname, allowedHosts) {
  return allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

async function validateActivePlatformTab(platform) {
  let url;
  try {
    url = new URL(await getActiveTabUrl());
  } catch {
    return platform.hint || "请先切换到对应平台页面";
  }

  if (!hostnameMatches(url.hostname, platform.hosts || [])) {
    return platform.hint || "请先切换到对应平台页面";
  }
  return "";
}

async function getActivePlatform() {
  let url;
  try {
    url = new URL(await getActiveTabUrl());
  } catch {
    return {
      platformId: "",
      name: "",
      hostname: "",
      supported: false,
      detail: "当前页面暂不支持",
    };
  }

  for (const [platformId, platform] of Object.entries(platforms)) {
    if (hostnameMatches(url.hostname, platform.hosts || [])) {
      return {
        platformId,
        name: platform.name,
        hostname: url.hostname,
        supported: true,
        detail: `当前页面：${platform.name}，可执行`,
      };
    }
  }

  return {
    platformId: "",
    name: "",
    hostname: url.hostname,
    supported: false,
    detail: "当前页面暂不支持",
  };
}

async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || { runs: {}, logs: [] };
}

function hasRunningTask(state) {
  return Object.values(state?.runs || {}).some((item) => item?.status === "running");
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  return state;
}

async function resetLogsForRun() {
  const state = await getState();
  state.logs = [];
  return setState(state);
}

async function resetRunsForNewRun(activePlatformId, platform, startedAt) {
  const runs = {};
  for (const [platformId, platformConfig] of Object.entries(platforms)) {
    runs[platformId] = {
      platformId,
      name: platformConfig.name,
      status: platformId === activePlatformId ? "running" : "idle",
      detail: platformId === activePlatformId ? "执行中" : "",
      startedAt: platformId === activePlatformId ? startedAt : "",
    };
  }
  const state = await getState();
  state.runs = runs;
  return setState(state);
}

async function markPlatformRunning(platformId, platform, startedAt, detail = "执行中") {
  const state = await getState();
  state.runs = state.runs || {};
  state.runs[platformId] = {
    platformId,
    name: platform.name,
    status: "running",
    detail,
    startedAt,
  };
  return setState(state);
}

async function resetPanelState() {
  const runs = {};
  for (const [platformId, platformConfig] of Object.entries(platforms)) {
    runs[platformId] = {
      platformId,
      name: platformConfig.name,
      status: "idle",
      detail: "",
      startedAt: "",
    };
  }
  return setState({ runs, logs: [] });
}

async function appendLog(entry) {
  const state = await getState();
  state.logs = [entry, ...(state.logs || [])].slice(0, MAX_LOGS);
  state.runs = state.runs || {};
  state.runs[entry.platformId] = entry;
  return setState(state);
}

function waitForTabReady(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;

    const finish = () => {
      if (done) return;
      done = true;
      globalThis.clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    timer = globalThis.setTimeout(finish, timeoutMs);
  });
}

async function runPlatform(platformId, options = {}) {
  const {
    ignoreRunning = false,
    resetLogs = true,
    resetRuns = true,
    runningDetail = "执行中",
  } = options;
  const platform = platforms[platformId];
  if (!platform) {
    throw new Error(`Unknown platform: ${platformId}`);
  }

  if (!ignoreRunning) {
    const currentState = await getState();
    if (hasRunningTask(currentState)) {
      return currentState;
    }
  }

  if (resetLogs) {
    await resetLogsForRun();
  }
  const startedAt = new Date().toISOString();
  if (resetRuns) {
    await resetRunsForNewRun(platformId, platform, startedAt);
  } else {
    await markPlatformRunning(platformId, platform, startedAt, runningDetail);
  }

  const logProgress = async (detail) => {
    if (platformId !== "linuxdo") return;
    await appendLog({
      platformId,
      name: platform.name,
      status: "running",
      detail,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  };

  try {
    await logProgress("开始执行");
    await logProgress("检查当前标签页");
    const tabError = await validateActivePlatformTab(platform);
    if (tabError) {
      const entry = {
        platformId,
        name: platform.name,
        status: "error",
        detail: tabError,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      await appendLog(entry);
      return getState();
    }

    const result = await platform.run({ log: logProgress });
    const entry = {
      platformId,
      name: platform.name,
      status: result.success ? "success" : result.skipped ? "skipped" : "error",
      detail: result.detail || "",
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await appendLog(entry);
  } catch (error) {
    const entry = {
      platformId,
      name: platform.name,
      status: "error",
      detail: error?.message || String(error),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await appendLog(entry);
  }

  return getState();
}

async function openPlatform(platformId) {
  const platform = platforms[platformId];
  if (!platform?.homeUrl) {
    throw new Error(`Unknown platform: ${platformId}`);
  }

  const tab = await chrome.tabs.create({ url: platform.homeUrl, active: true });
  return { ok: true, tabId: tab.id };
}

async function openProjectPage() {
  const tab = await chrome.tabs.create({ url: PROJECT_URL, active: true });
  return { ok: true, tabId: tab.id };
}

async function runAllPlatforms() {
  const currentState = await getState();
  if (hasRunningTask(currentState)) {
    return currentState;
  }

  await resetPanelState();
  await setState({ ...(await getState()), logs: [] });

  for (const platformId of PLATFORM_ORDER) {
    const platform = platforms[platformId];
    if (!platform?.homeUrl) continue;

    const tab = await chrome.tabs.create({ url: platform.homeUrl, active: true });
    await markPlatformRunning(platformId, platform, new Date().toISOString(), "打开页面并准备执行");
    await waitForTabReady(tab.id);
    await chrome.tabs.update(tab.id, { active: true });
    await runPlatform(platformId, {
      ignoreRunning: true,
      resetLogs: false,
      resetRuns: false,
      runningDetail: "执行中",
    });
  }

  return getState();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    if (message?.type === "linuxdo-progress") {
      return appendLog({
        platformId: "linuxdo",
        name: platforms.linuxdo.name,
        status: "running",
        detail: String(message.detail || ""),
        startedAt: "",
        finishedAt: new Date().toISOString(),
      });
    }
    if (message?.type === "get-state") {
      return getState();
    }
    if (message?.type === "get-active-platform") {
      return getActivePlatform();
    }
    if (message?.type === "clear-logs") {
      const state = await getState();
      return setState({ ...state, logs: [] });
    }
    if (message?.type === "reset-panel") {
      return resetPanelState();
    }
    if (message?.type === "run-platform") {
      return runPlatform(message.platformId);
    }
    if (message?.type === "open-platform") {
      return openPlatform(message.platformId);
    }
    if (message?.type === "open-project") {
      return openProjectPage();
    }
    if (message?.type === "run-all-platforms") {
      return runAllPlatforms();
    }
    return { error: "Unknown message" };
  };

  handle().then(sendResponse).catch((error) => {
    sendResponse({ error: error?.message || String(error) });
  });
  return true;
});
