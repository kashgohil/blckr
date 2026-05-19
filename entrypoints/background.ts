import {
  loadState,
  saveState,
  todayKey,
  hostnameFromUrl,
  matchRule,
  type BlockerState,
} from "@/utils/blocker";

const TICK_SECONDS = 15;

export default defineBackground(() => {
  let activeHost: string | null = null;
  let activeTabId: number | null = null;
  let lastTickAt: number = Date.now();
  let windowFocused = true;

  const blockedPageUrl = browser.runtime.getURL("/blocked.html");

  async function redirectIfBlocked(
    tabId: number,
    url: string,
    state?: BlockerState,
  ) {
    if (!url || url.startsWith(blockedPageUrl)) return false;
    const host = hostnameFromUrl(url);
    if (!host) return false;
    const s = state ?? (await loadState());
    const rule = matchRule(host, s.rules);
    if (!rule) return false;

    const today = todayKey();
    const hardBlock = !rule.timeLimitMinutes;
    const dailyBlocked = s.dailyBlocks[today]?.includes(rule.domain);

    // Self-heal: if a time-based rule's flag is stale (current usage is now
    // under the limit — e.g. the user raised the allowance), clear it.
    if (!hardBlock && dailyBlocked) {
      const used = s.usage[today]?.[rule.domain] ?? 0;
      const limit = rule.timeLimitMinutes! * 60;
      if (used < limit) {
        const cleaned = (s.dailyBlocks[today] ?? []).filter(
          (d) => d !== rule.domain,
        );
        await saveState({
          dailyBlocks: { ...s.dailyBlocks, [today]: cleaned },
        });
        return false;
      }
    }

    if (hardBlock || dailyBlocked) {
      const reason = hardBlock ? "blocked" : "timeup";
      const target = `${blockedPageUrl}?host=${encodeURIComponent(host)}&reason=${reason}&url=${encodeURIComponent(url)}`;
      try {
        await browser.tabs.update(tabId, { url: target });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async function setActiveFromTab(tab: Browser.tabs.Tab | undefined) {
    await flushTime();
    activeTabId = tab?.id ?? null;
    activeHost = tab?.url ? hostnameFromUrl(tab.url) : null;
    lastTickAt = Date.now();
  }

  async function flushTime() {
    if (!activeHost || !windowFocused) {
      lastTickAt = Date.now();
      return;
    }
    const now = Date.now();
    const elapsed = Math.floor((now - lastTickAt) / 1000);
    if (elapsed <= 0) return;
    lastTickAt = now;

    const state = await loadState();
    const rule = matchRule(activeHost, state.rules);
    if (!rule || !rule.timeLimitMinutes) return;

    const today = todayKey();
    const dayUsage = { ...(state.usage[today] ?? {}) };
    dayUsage[rule.domain] = (dayUsage[rule.domain] ?? 0) + elapsed;
    const usage = { ...state.usage, [today]: dayUsage };

    let dailyBlocks = state.dailyBlocks;
    const limitSeconds = rule.timeLimitMinutes * 60;
    if (dayUsage[rule.domain] >= limitSeconds) {
      const todays = new Set(dailyBlocks[today] ?? []);
      todays.add(rule.domain);
      dailyBlocks = { ...dailyBlocks, [today]: [...todays] };
    }

    await saveState({ usage, dailyBlocks });

    if (dailyBlocks[today]?.includes(rule.domain) && activeTabId != null) {
      try {
        const tab = await browser.tabs.get(activeTabId);
        if (tab.url) await redirectIfBlocked(activeTabId, tab.url);
      } catch {}
    }
  }

  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await browser.tabs.get(tabId);
      await setActiveFromTab(tab);
      if (tab.url) await redirectIfBlocked(tabId, tab.url);
    } catch {}
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      if (tab.active) await setActiveFromTab(tab);
      await redirectIfBlocked(tabId, changeInfo.url);
    } else if (changeInfo.status === "complete" && tab.active) {
      await setActiveFromTab(tab);
    }
  });

  browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return;
    await redirectIfBlocked(details.tabId, details.url);
  });

  browser.windows.onFocusChanged.addListener(async (windowId) => {
    windowFocused = windowId !== browser.windows.WINDOW_ID_NONE;
    if (!windowFocused) {
      await flushTime();
      activeHost = null;
    } else {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await setActiveFromTab(tab);
    }
  });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.rules) return;
    const tabs = await browser.tabs.query({});
    const state = await loadState();
    for (const t of tabs) {
      if (t.id != null && t.url) await redirectIfBlocked(t.id, t.url, state);
    }
  });

  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === "blckr:check-redirect") {
      const tabId = sender.tab?.id;
      const url = sender.tab?.url;
      if (tabId != null && url) {
        (async () => {
          // Force-flush accrued time so usage reflects the moment the pill
          // hit zero, then run the standard redirect logic.
          await flushTime();
          await redirectIfBlocked(tabId, url);
        })();
      }
    }
    return false;
  });

  browser.alarms.create("blckr-tick", { periodInMinutes: TICK_SECONDS / 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "blckr-tick") flushTime();
  });

  (async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await setActiveFromTab(tab);
    if (tab?.id != null && tab.url) await redirectIfBlocked(tab.id, tab.url);
  })();
});
