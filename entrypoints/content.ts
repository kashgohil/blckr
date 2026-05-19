import {
  loadState,
  hostnameFromUrl,
  matchRule,
  todayKey,
} from "@/utils/blocker";

const POS_KEY = "blckrPillPos";
const DISMISS_SESSION_KEY = "blckr-pill-dismissed";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  async main() {
    if (window.top !== window) return; // top frame only
    const host = hostnameFromUrl(location.href);
    if (!host) return;

    let state = await loadState();
    let rule = matchRule(host, state.rules);
    if (!rule || !rule.timeLimitMinutes) return;

    // Session dismiss
    try {
      if (sessionStorage.getItem(DISMISS_SESSION_KEY) === "1") return;
    } catch {}

    const pill = mountPill();

    let limitSec = rule.timeLimitMinutes * 60;
    let usedAtSync = state.usage[todayKey()]?.[rule.domain] ?? 0;
    let syncedAt = Date.now();
    let redirectRequested = false;
    let torn = false;

    function currentUsed(): number {
      if (document.visibilityState !== "visible" || !document.hasFocus()) {
        return usedAtSync;
      }
      const elapsed = Math.floor((Date.now() - syncedAt) / 1000);
      return usedAtSync + Math.max(0, elapsed);
    }

    function render() {
      if (torn || !rule || !rule.timeLimitMinutes) return;
      const used = currentUsed();
      const remaining = Math.max(0, limitSec - used);
      pill.setRemaining(remaining, limitSec);

      if (remaining <= 0 && !redirectRequested) {
        redirectRequested = true;
        browser.runtime
          .sendMessage({ type: "blckr:check-redirect" })
          .catch(() => {});
      }
    }

    async function sync() {
      if (torn) return;
      try {
        state = await loadState();
        rule = matchRule(host!, state.rules);
        if (!rule || !rule.timeLimitMinutes) {
          // Rule was removed or converted to hard-block — fold up entirely.
          teardown();
          return;
        }
        limitSec = rule.timeLimitMinutes * 60;
        const storageUsed = state.usage[todayKey()]?.[rule.domain] ?? 0;
        const localUsed = currentUsed();
        usedAtSync = Math.max(storageUsed, localUsed);
        syncedAt = Date.now();
        if (limitSec - usedAtSync > 0) redirectRequested = false;
        render();
      } catch {}
    }

    // ── Listeners (declared up-front so teardown can detach them) ──
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onFocus = () => sync();
    const onPageHide = () => teardown();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    // `pagehide` fires on tab close, navigation away, and bfcache stash.
    window.addEventListener("pagehide", onPageHide);

    // 250ms so the displayed value lands on second-boundaries even when
    // setInterval drifts a few ms (no "skipped second" feel).
    const tick = window.setInterval(render, 250);
    const syncTimer = window.setInterval(sync, 10000);

    function teardown() {
      if (torn) return;
      torn = true;
      clearInterval(tick);
      clearInterval(syncTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      pill.destroy();
    }

    pill.onClose(() => {
      try {
        sessionStorage.setItem(DISMISS_SESSION_KEY, "1");
      } catch {}
      teardown();
    });

    render();
  },
});

interface PillHandle {
  setRemaining: (remainingSec: number, limitSec: number) => void;
  onClose: (cb: () => void) => void;
  destroy: () => void;
}

function mountPill(): PillHandle {
  const hostEl = document.createElement("div");
  hostEl.id = "blckr-pill-root";
  hostEl.style.all = "initial";
  hostEl.style.position = "fixed";
  hostEl.style.zIndex = "2147483647";
  document.documentElement.appendChild(hostEl);

  const shadow = hostEl.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .pill {
      position: fixed;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 8px 8px 10px;
      background: #100f0d;
      color: #f3ead8;
      border: 1px solid #2a271d;
      border-radius: 999px;
      font-family: ui-monospace, "SF Mono", "Menlo", "IBM Plex Mono", monospace;
      font-size: 12px;
      line-height: 1;
      letter-spacing: 0.02em;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255,255,255,0.04) inset;
      user-select: none;
      cursor: grab;
      transition: opacity 0.15s, transform 0.15s;
      will-change: transform;
    }
    .pill.dragging { cursor: grabbing; transition: none; opacity: 0.92; }
    .pill.over { border-color: #7d9aa6; }
    .pill.warn {
      border-color: #7d9aa6;
      animation: pillPulse 1.2s ease-in-out infinite;
    }
    @keyframes pillPulse {
      0%, 100% {
        box-shadow:
          0 6px 20px rgba(0,0,0,0.35),
          0 0 0 0 rgba(125,154,166,0.55);
      }
      50% {
        box-shadow:
          0 6px 20px rgba(0,0,0,0.35),
          0 0 0 8px rgba(125,154,166,0);
      }
    }
    .grip {
      color: #6a6457;
      font-size: 10px;
      letter-spacing: -2px;
      padding-right: 2px;
    }
    .time {
      color: #f3ead8;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .pill.over .time,
    .pill.warn .time { color: #7d9aa6; }
    .sep { color: #6a6457; padding: 0 2px; }
    .host {
      color: #a39c8c;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .close {
      all: unset;
      width: 18px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: #6a6457;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      transition: color 0.15s, background 0.15s;
    }
    .close:hover { color: #f3ead8; background: rgba(243,234,216,0.08); }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #7d9aa6;
      flex-shrink: 0;
    }
    .pill.over .dot { animation: pulse 1.6s ease-in-out infinite; }
    .pill.warn .dot { animation: pulse 0.9s ease-in-out infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.6); }
    }
  `;

  const pill = document.createElement("div");
  pill.className = "pill";
  pill.innerHTML = `
    <span class="dot" aria-hidden="true"></span>
    <span class="grip" aria-hidden="true">⋮⋮</span>
    <span class="time">--:--</span>
    <span class="sep">·</span>
    <span class="host"></span>
    <button class="close" type="button" title="hide for this session" aria-label="Hide">×</button>
  `;

  shadow.append(style, pill);

  const timeEl = pill.querySelector(".time") as HTMLElement;
  const hostNameEl = pill.querySelector(".host") as HTMLElement;
  const closeEl = pill.querySelector(".close") as HTMLElement;
  hostNameEl.textContent = hostnameFromUrl(location.href) ?? "";

  // ── Position (persisted to chrome.storage) ──
  const PAD = 16;
  const DEFAULT_POS = () => ({
    x: window.innerWidth - pill.offsetWidth - PAD,
    y: window.innerHeight - pill.offsetHeight - PAD,
  });

  function applyPos(x: number, y: number) {
    const w = pill.offsetWidth || 220;
    const h = pill.offsetHeight || 36;
    const cx = Math.max(PAD, Math.min(window.innerWidth - w - PAD, x));
    const cy = Math.max(PAD, Math.min(window.innerHeight - h - PAD, y));
    pill.style.left = cx + "px";
    pill.style.top = cy + "px";
    pill.style.right = "auto";
    pill.style.bottom = "auto";
  }

  let destroyed = false;
  let positionRaf = 0;
  (async () => {
    let pos: { x: number; y: number };
    try {
      const stored = (await browser.storage.local.get(POS_KEY)) as {
        [k: string]: { x: number; y: number } | undefined;
      };
      pos = stored[POS_KEY] ?? DEFAULT_POS();
    } catch {
      pos = DEFAULT_POS();
    }
    if (destroyed) return;
    positionRaf = requestAnimationFrame(() => applyPos(pos.x, pos.y));
  })();

  // ── Drag (listeners are on the pill, removed with the host element) ──
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".close")) return;
    dragging = true;
    pill.classList.add("dragging");
    startX = e.clientX;
    startY = e.clientY;
    const rect = pill.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    pill.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    applyPos(origLeft + (e.clientX - startX), origTop + (e.clientY - startY));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    pill.classList.remove("dragging");
    try {
      pill.releasePointerCapture(e.pointerId);
    } catch {}
    const rect = pill.getBoundingClientRect();
    browser.storage.local
      .set({ [POS_KEY]: { x: rect.left, y: rect.top } })
      .catch(() => {});
  };

  pill.addEventListener("pointerdown", onPointerDown);
  pill.addEventListener("pointermove", onPointerMove);
  pill.addEventListener("pointerup", onPointerUp);
  pill.addEventListener("pointercancel", onPointerUp);

  // ── Keep in-bounds on resize (window listener — must be detached on destroy) ──
  const onResize = () => {
    const rect = pill.getBoundingClientRect();
    applyPos(rect.left, rect.top);
  };
  window.addEventListener("resize", onResize);

  let closeCb: (() => void) | null = null;
  const onCloseClick = (e: Event) => {
    e.stopPropagation();
    closeCb?.();
  };
  closeEl.addEventListener("click", onCloseClick);

  function fmt(sec: number) {
    if (sec <= 0) return "0m left";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m left`;
    if (m >= 1) return `${m}m ${String(s).padStart(2, "0")}s left`;
    return `${s}s left`;
  }

  return {
    setRemaining(remainingSec) {
      if (destroyed) return;
      timeEl.textContent = fmt(remainingSec);
      const isOver = remainingSec <= 0;
      const isWarn = !isOver && remainingSec <= 60;
      pill.classList.toggle("over", isOver);
      pill.classList.toggle("warn", isWarn);
    },
    onClose(cb) {
      closeCb = cb;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (positionRaf) cancelAnimationFrame(positionRaf);
      window.removeEventListener("resize", onResize);
      // Listeners on `pill` / `closeEl` live inside the shadow root, which is
      // removed with the host element below — they become unreachable and GC'd.
      closeCb = null;
      hostEl.remove();
    },
  };
}
