<script lang="ts" setup>
import { computed, onMounted, ref } from "vue";
import {
  loadState,
  matchRule,
  saveState,
  todayKey,
  type BlockerState,
} from "@/utils/blocker";

type Tab = "site" | "history" | "alt";

const params = new URLSearchParams(window.location.search);
const host = params.get("host") ?? "this site";
const reason = params.get("reason") ?? "blocked";

const state = ref<BlockerState | null>(null);
const now = ref(new Date());
const tab = ref<Tab>("site");

onMounted(async () => {
  const s = await loadState();

  // Re-check whether this site is still blocked. The user may have raised the
  // daily limit, removed the rule, reset today's usage, or the day may have
  // rolled over. In any of those cases, bounce them back to the original URL
  // instead of showing the blocked page.
  const targetUrl = params.get("url");
  const r = matchRule(host, s.rules);
  const today = todayKey();

  let shouldUnblock = false;
  let cleanedState = s;

  if (!r) {
    // Rule removed entirely.
    shouldUnblock = true;
  } else if (r.timeLimitMinutes) {
    const used = s.usage[today]?.[r.domain] ?? 0;
    if (used < r.timeLimitMinutes * 60) {
      shouldUnblock = true;
      // Clear stale time-up flag so the background doesn't redirect again.
      if ((s.dailyBlocks[today] ?? []).includes(r.domain)) {
        const cleaned = (s.dailyBlocks[today] ?? []).filter(
          (d) => d !== r.domain,
        );
        const nextBlocks = { ...s.dailyBlocks, [today]: cleaned };
        await saveState({ dailyBlocks: nextBlocks });
        cleanedState = { ...s, dailyBlocks: nextBlocks };
      }
    }
  }
  // Hard blocks (no timeLimitMinutes) always remain blocked.

  if (shouldUnblock && targetUrl) {
    location.replace(targetUrl);
    return;
  }

  state.value = cleanedState;
  setInterval(() => (now.value = new Date()), 1000);
});

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const rule = computed(() => state.value?.rules.find((r) => r.domain === host) ?? null);

const todaySeconds = computed(() => {
  if (!state.value) return 0;
  return state.value.usage[todayKey()]?.[host] ?? 0;
});

const limitSeconds = computed(() =>
  rule.value?.timeLimitMinutes ? rule.value.timeLimitMinutes * 60 : 0,
);

const overBy = computed(() => Math.max(0, todaySeconds.value - limitSeconds.value));

const last7 = computed(() => {
  const out: { key: string; label: string; date: string; sec: number; isToday: boolean; blocked: boolean }[] = [];
  if (!state.value) return out;
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dateKey(d);
    out.push({
      key: k,
      label: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()],
      date: pad(d.getDate()),
      sec: state.value.usage[k]?.[host] ?? 0,
      isToday: i === 0,
      blocked: (state.value.dailyBlocks[k] ?? []).includes(host),
    });
  }
  return out;
});

const peak7 = computed(() => Math.max(1, ...last7.value.map((d) => d.sec)));

const weekTotalHere = computed(() =>
  last7.value.reduce((a, b) => a + b.sec, 0),
);

const blockedDaysHere = computed(() =>
  last7.value.filter((d) => d.blocked).length,
);

const activeDays = computed(() =>
  last7.value.filter((d) => d.sec > 0).length,
);

const dailyAvg = computed(() => {
  const n = activeDays.value || 1;
  return Math.round(weekTotalHere.value / n);
});

const peakDay = computed(() =>
  last7.value.reduce((m, d) => (d.sec > m.sec ? d : m), last7.value[0]),
);

function fmtHMS(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function fmtParts(seconds: number) {
  if (!seconds) return { n: "0", u: "m" };
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return { n: `${h}h ${pad(m)}`, u: "m" };
  if (m > 0) return { n: `${m}`, u: "m" };
  return { n: `${seconds}`, u: "s" };
}
function fmtJoin(seconds: number) {
  const p = fmtParts(seconds);
  return `${p.n}${p.u}`;
}

const todayDisp = computed(() => fmtParts(todaySeconds.value));
const overDisp = computed(() => fmtParts(overBy.value));
const weekDisp = computed(() => fmtParts(weekTotalHere.value));
const avgDisp = computed(() => fmtParts(dailyAvg.value));

const headline = computed(() =>
  reason === "timeup" ? "Time's up." : "Not now.",
);
const subhead = computed(() =>
  reason === "timeup"
    ? `You spent your daily budget on ${host}.`
    : `${host} is on your hard-block list.`,
);
const status = computed(() =>
  reason === "timeup" ? "DAILY BUDGET EXHAUSTED" : "HARD BLOCK ENGAGED",
);

const untilMidnight = computed(() => {
  const n = now.value;
  const mid = new Date(n);
  mid.setHours(24, 0, 0, 0);
  return Math.floor((mid.getTime() - n.getTime()) / 1000);
});

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function fmtLong(isoKey: string): string {
  const [y, m, d] = isoKey.split("-").map(Number);
  if (!y || !m || !d) return isoKey;
  return `${d} ${MONTHS[m - 1]}, ${y}`;
}
const dateShort = computed(() => fmtLong(todayKey()) || "");


function goBack() {
  history.length > 1 ? history.back() : window.close();
}

const tabs: { id: Tab; label: string }[] = [
  { id: "site", label: "This site" },
  { id: "history", label: "History" },
  { id: "alt", label: "Instead" },
];
</script>

<template>
  <main class="app">
    <header class="head">
      <div class="kicker">
        <span class="dot" />
        <span>TIMELOCK</span>
      </div>
      <div class="date">{{ dateShort }}</div>
    </header>

    <!-- ─── BLOCK ANNOUNCEMENT ─────────────────────────── -->
    <section class="announce">
      <div class="status-row">
        <span class="status-pill">
          <span class="status-pulse" />
          BLOCKED
        </span>
        <span class="status-text">{{ status }}</span>
        <button class="back" @click="goBack">← step away</button>
      </div>

      <h1 class="headline">{{ headline }}</h1>
      <p class="subhead">{{ subhead }}</p>

      <div class="host-line">
        <span class="host-label">SITE</span>
        <span class="host-name">{{ host }}</span>
      </div>
    </section>

    <!-- ─── TABS ─────────────────────────────────────────── -->
    <nav class="tabs" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.id"
        :class="['tab', { active: tab === t.id }]"
        role="tab"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- ─── THIS SITE ────────────────────────────────────── -->
    <section v-if="tab === 'site'" class="panel">
      <div class="hero">
        <div class="eyebrow">TIME SPENT TODAY</div>
        <div class="hero-num">
          <span class="num">{{ todayDisp.n }}</span>
          <span class="unit">{{ todayDisp.u }}</span>
        </div>
        <div class="hero-trend">
          <template v-if="limitSeconds">
            <span class="over" v-if="overBy > 0">
              ▲ over by {{ overDisp.n }}{{ overDisp.u }}
            </span>
            <span class="vs">of {{ rule?.timeLimitMinutes }}m allotted</span>
          </template>
          <template v-else>
            <span class="vs">no daily allowance · hard block</span>
          </template>
        </div>
      </div>

      <div class="divider" />

      <div class="kv">
        <div class="kv-row">
          <span class="k">rule</span>
          <span class="v">
            <template v-if="rule?.timeLimitMinutes">
              {{ rule.timeLimitMinutes }} minutes per day
            </template>
            <template v-else>
              always blocked
            </template>
          </span>
        </div>
        <div class="kv-row">
          <span class="k">resets in</span>
          <span class="v mono">{{ fmtHMS(untilMidnight) }}</span>
        </div>
        <div class="kv-row">
          <span class="k">added</span>
          <span class="v">{{ rule ? "tracked by you" : "no active rule" }}</span>
        </div>
      </div>
    </section>

    <!-- ─── HISTORY ──────────────────────────────────────── -->
    <section v-else-if="tab === 'history'" class="panel">
      <div class="trio">
        <div class="t-stat">
          <div class="t-num">{{ weekDisp.n }}<span class="t-unit">{{ weekDisp.u }}</span></div>
          <div class="t-lbl">7-day total</div>
        </div>
        <div class="t-stat">
          <div class="t-num">{{ avgDisp.n }}<span class="t-unit">{{ avgDisp.u }}</span></div>
          <div class="t-lbl">daily avg</div>
        </div>
        <div class="t-stat">
          <div class="t-num">{{ blockedDaysHere }}</div>
          <div class="t-lbl">block-days</div>
        </div>
      </div>

      <div class="divider" />

      <div class="section-h">
        <span class="bar-h" /><span>LAST 7 DAYS · {{ host }}</span>
      </div>

      <div class="chart">
        <div
          v-for="d in last7"
          :key="d.key"
          class="chart-col"
          :class="{ today: d.isToday, empty: d.sec === 0, blocked: d.blocked }"
        >
          <div class="chart-val">{{ d.sec ? fmtJoin(d.sec) : "—" }}</div>
          <div class="chart-bar-wrap">
            <div
              class="chart-bar"
              :style="{ height: Math.max(2, (d.sec / peak7) * 100) + '%' }"
            />
          </div>
          <div class="chart-day">{{ d.label }}</div>
          <div class="chart-date">{{ d.date }}</div>
        </div>
      </div>

      <div class="divider" />

      <div class="section-h">
        <span class="bar-h" /><span>PEAK</span>
      </div>
      <p class="muted-line" v-if="peakDay && peakDay.sec > 0">
        Heaviest day was <span class="ink">{{ fmtLong(peakDay.key) }}</span> ·
        <span class="ink">{{ fmtJoin(peakDay.sec) }}</span>
      </p>
      <p class="muted-line" v-else>
        No recorded time on {{ host }} this week.
      </p>
    </section>

    <!-- ─── INSTEAD ──────────────────────────────────────── -->
    <section v-else class="panel">
      <div class="section-h">
        <span class="bar-h" /><span>TRY ONE OF THESE</span>
        <span class="section-meta">five small antidotes</span>
      </div>

      <ol class="alt-list">
        <li class="alt-item">
          <div class="alt-head">
            <span class="alt-num">01</span>
            <span class="alt-title">A walk. Ten minutes.</span>
            <span class="alt-meta">10 MIN · OUTSIDE</span>
          </div>
          <p class="alt-body">
            No phone, no headphones. Just the noise of wherever you actually are.
            Let your eyes focus on something further than three feet away.
          </p>
        </li>

        <li class="alt-item">
          <div class="alt-head">
            <span class="alt-num">02</span>
            <span class="alt-title">The book on your nightstand.</span>
            <span class="alt-meta">20 MIN · SLOW</span>
          </div>
          <p class="alt-body">
            You bought it for a reason. Read one chapter — or twenty pages,
            whichever comes first. Bookmark where you stop.
          </p>
        </li>

        <li class="alt-item">
          <div class="alt-head">
            <span class="alt-num">03</span>
            <span class="alt-title">Water, a stretch, fresh air.</span>
            <span class="alt-meta">2 MIN · RESET</span>
          </div>
          <p class="alt-body">
            Stand up. Drink a full glass of water. Roll your shoulders back twice
            and crack a window. The smallest reset you can do without thinking.
          </p>
        </li>

        <li class="alt-item">
          <div class="alt-head">
            <span class="alt-num">04</span>
            <span class="alt-title">The task you've been avoiding.</span>
            <span class="alt-meta">25 MIN · DEEP</span>
          </div>
          <p class="alt-body">
            You know the one. Set a timer for twenty-five minutes and start
            badly — momentum beats motivation. Stop when it rings.
          </p>
        </li>

        <li class="alt-item">
          <div class="alt-head">
            <span class="alt-num">05</span>
            <span class="alt-title">A person you owe a message.</span>
            <span class="alt-meta">5 MIN · CONNECT</span>
          </div>
          <p class="alt-body">
            Pick the name that just surfaced in your head. Send a short,
            specific note — not "how have you been," but a real thing.
          </p>
        </li>
      </ol>

      <p class="alt-foot">
        Pick one. Set a small timer. Come back if you must — but you probably won't.
      </p>
    </section>

    <footer class="foot">
      <span>Attention is currency.</span>
      <span class="foot-r">spend it well</span>
    </footer>
  </main>
</template>

<style scoped>
.app {
  max-width: 600px;
  margin: 0 auto;
  padding: 32px 24px;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  color: var(--ink);
  background: var(--paper);
}

/* ── header ───────────────────────────────────────────── */
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--ink-dim);
}
.kicker { display: flex; align-items: center; gap: 8px; }
.dot {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
}
.date {
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

/* ── announcement ─────────────────────────────────────── */
.announce {
  margin-top: 28px;
  padding: 24px;
  border: 1px solid var(--rule);
  background: var(--paper-2);
}
.status-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--accent);
  color: var(--paper);
  padding: 5px 10px;
  font: 600 10px "IBM Plex Mono", monospace;
  letter-spacing: 0.22em;
}
.status-pulse {
  width: 6px;
  height: 6px;
  background: var(--paper);
  border-radius: 50%;
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
.status-text {
  font-size: 9.5px;
  letter-spacing: 0.2em;
  color: var(--ink-faint);
}
.back {
  margin-left: auto;
  background: transparent;
  color: var(--ink-faint);
  border: 1px solid var(--rule);
  padding: 5px 10px;
  font: 400 10px "IBM Plex Mono", monospace;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.back:hover {
  color: var(--ink);
  border-color: var(--ink-faint);
}

.headline {
  font-family: "Newsreader", serif;
  font-variation-settings: "opsz" 72;
  font-weight: 500;
  font-size: 56px;
  line-height: 0.95;
  letter-spacing: -0.025em;
  margin: 0;
  color: var(--ink);
}
.subhead {
  font-family: "Newsreader", serif;
  font-style: italic;
  font-weight: 400;
  font-size: 17px;
  color: var(--ink-dim);
  margin: 10px 0 18px;
  letter-spacing: -0.005em;
}
.host-line {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--rule);
  background: var(--paper);
}
.host-label {
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--ink-faint);
}
.host-name {
  font-family: "IBM Plex Mono", monospace;
  font-weight: 500;
  font-size: 12px;
  color: var(--accent);
}

/* ── tabs (same as popup) ─────────────────────────────── */
.tabs {
  display: flex;
  margin-top: 22px;
  border-bottom: 1px solid var(--rule);
}
.tab {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  color: var(--ink-faint);
  font: 500 11px "IBM Plex Mono", monospace;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 12px 0;
  cursor: pointer;
  transition: color 0.15s;
  margin-bottom: -1px;
}
.tab:hover { color: var(--ink); background: transparent; }
.tab.active {
  color: var(--ink);
  border-bottom-color: var(--accent);
}

/* ── panel ─────────────────────────────────────────────── */
.panel {
  padding-top: 22px;
  animation: fade 0.25s ease;
}
@keyframes fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

.divider {
  height: 1px;
  background: var(--rule);
  margin: 20px 0;
}

.section-h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--ink-dim);
  margin-bottom: 14px;
}
.section-h .bar-h {
  width: 12px;
  height: 1px;
  background: var(--accent);
}

.muted-line {
  color: var(--ink-faint);
  font-size: 12px;
  margin: 4px 0;
}
.muted-line .ink { color: var(--ink); }

/* ── hero (same as popup) ─────────────────────────────── */
.hero { padding: 4px 0; }
.eyebrow {
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-faint);
  margin-bottom: 8px;
}
.hero-num {
  font-family: "Newsreader", serif;
  font-variation-settings: "opsz" 72;
  font-weight: 500;
  line-height: 0.9;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.hero-num .num {
  font-size: 80px;
  letter-spacing: -0.035em;
}
.hero-num .unit {
  font-family: "IBM Plex Mono", monospace;
  font-size: 20px;
  color: var(--ink-dim);
  font-weight: 400;
}
.hero-trend {
  margin-top: 12px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--ink-faint);
}
.vs { font-variant-numeric: tabular-nums; }
.over { color: var(--accent); font-weight: 500; }

/* ── key/value list ───────────────────────────────────── */
.kv { display: flex; flex-direction: column; }
.kv-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 0;
  border-top: 1px solid var(--rule);
  font-size: 12px;
}
.kv-row:first-child { border-top: none; padding-top: 2px; }
.k {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
  text-transform: uppercase;
}
.v {
  color: var(--ink);
  font-family: "Newsreader", serif;
  font-style: italic;
  font-size: 14px;
}
.v.mono {
  font-family: "IBM Plex Mono", monospace;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

/* ── trio stat ─────────────────────────────────────────── */
.trio {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
}
.t-stat {
  background: var(--paper);
  padding: 12px 14px;
}
.t-num {
  font-family: "Newsreader", serif;
  font-variation-settings: "opsz" 36;
  font-weight: 500;
  font-size: 24px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.t-unit {
  font-family: "IBM Plex Mono", monospace;
  font-size: 11px;
  color: var(--ink-dim);
  margin-left: 2px;
  font-weight: 400;
}
.t-lbl {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
  margin-top: 8px;
  text-transform: uppercase;
}

/* ── chart (same as popup) ─────────────────────────────── */
.chart {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  align-items: end;
  height: 140px;
}
.chart-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  position: relative;
  padding-bottom: 30px;
  color: var(--ink-faint);
}
.chart-bar-wrap {
  width: 100%;
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.chart-bar {
  width: 100%;
  background: var(--ink-faint);
  min-height: 2px;
  transition: height 0.5s ease;
}
.chart-col.today .chart-bar { background: var(--accent); }
.chart-col.empty .chart-bar { background: var(--rule); }
.chart-col.blocked .chart-bar { background: var(--accent); }
.chart-val {
  font-size: 10px;
  margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-dim);
}
.chart-col.today .chart-val { color: var(--accent); font-weight: 500; }
.chart-day {
  position: absolute;
  bottom: 14px;
  font-size: 9px;
  letter-spacing: 0.1em;
}
.chart-date {
  position: absolute;
  bottom: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}
.chart-col.today .chart-day,
.chart-col.today .chart-date { color: var(--ink); }

/* ── alternatives list ────────────────────────────────── */
.section-meta {
  margin-left: auto;
  color: var(--ink-faint);
  font-family: "IBM Plex Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.alt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.alt-item {
  padding: 18px 0 20px;
  border-top: 1px solid var(--rule);
}
.alt-item:first-child {
  border-top: none;
  padding-top: 4px;
}
.alt-head {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: baseline;
  column-gap: 16px;
  margin-bottom: 8px;
}
.alt-num {
  font-family: "Newsreader", serif;
  font-variation-settings: "opsz" 36;
  font-weight: 500;
  font-size: 22px;
  line-height: 1;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.alt-title {
  font-family: "Newsreader", serif;
  font-weight: 500;
  font-size: 19px;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--ink);
}
.alt-meta {
  font-family: "IBM Plex Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--accent);
  white-space: nowrap;
}
.alt-body {
  margin: 0 0 0 48px;
  font-family: "Newsreader", serif;
  font-weight: 400;
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink-dim);
  letter-spacing: -0.005em;
  max-width: 52ch;
}

.alt-foot {
  margin: 24px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  font-family: "Newsreader", serif;
  font-weight: 400;
  font-size: 14px;
  color: var(--ink-faint);
  letter-spacing: -0.005em;
}

/* ── footer ────────────────────────────────────────────── */
.foot {
  margin-top: 28px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  display: flex;
  justify-content: space-between;
  font-family: "Newsreader", serif;
  font-style: italic;
  font-size: 12px;
  color: var(--ink-faint);
}
.foot-r { color: var(--ink-dim); }
</style>
