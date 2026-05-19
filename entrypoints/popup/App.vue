<script lang="ts" setup>
import { onMounted, ref, computed } from "vue";
import {
  loadState,
  saveState,
  normalizeDomain,
  todayKey,
  type BlockRule,
  type BlockerState,
} from "@/utils/blocker";

type Tab = "today" | "sites" | "trends";

const tab = ref<Tab>("today");

const rules = ref<BlockRule[]>([]);
const usageAll = ref<Record<string, Record<string, number>>>({});
const blocksAll = ref<Record<string, string[]>>({});

const newDomain = ref("");
const newLimit = ref<number | null>(null);
const error = ref("");

async function refresh() {
  const s: BlockerState = await loadState();
  rules.value = s.rules;
  usageAll.value = s.usage;
  blocksAll.value = s.dailyBlocks;
}

onMounted(refresh);

async function addRule() {
  error.value = "";
  const domain = normalizeDomain(newDomain.value);
  if (!domain) {
    error.value = "enter a valid domain";
    return;
  }
  if (rules.value.some((r) => r.domain === domain)) {
    error.value = "already tracked";
    return;
  }
  const limit =
    newLimit.value && newLimit.value > 0 ? Math.floor(newLimit.value) : undefined;
  const next = [...rules.value, { domain, timeLimitMinutes: limit }];
  await saveState({ rules: next });
  newDomain.value = "";
  newLimit.value = null;
  await refresh();
}

async function removeRule(domain: string) {
  const next = rules.value.filter((r) => r.domain !== domain);
  await saveState({ rules: next });
  await refresh();
}

const editingDomain = ref<string | null>(null);
const editLimit = ref<number | null>(null);

function startEdit(r: BlockRule) {
  editingDomain.value = r.domain;
  editLimit.value = r.timeLimitMinutes ?? null;
}
function cancelEdit() {
  editingDomain.value = null;
  editLimit.value = null;
}
async function saveEdit(domain: string) {
  const limit =
    editLimit.value && editLimit.value > 0 ? Math.floor(editLimit.value) : undefined;
  const s = await loadState();
  const next = s.rules.map((r) =>
    r.domain === domain ? { ...r, timeLimitMinutes: limit } : r,
  );

  // Clear stale time-up flag if the new limit is now above current usage.
  const today = todayKey();
  let dailyBlocks = s.dailyBlocks;
  if (limit !== undefined) {
    const used = s.usage[today]?.[domain] ?? 0;
    if (used < limit * 60) {
      const cleaned = (dailyBlocks[today] ?? []).filter((d) => d !== domain);
      dailyBlocks = { ...dailyBlocks, [today]: cleaned };
    }
  }

  await saveState({ rules: next, dailyBlocks });
  cancelEdit();
  await refresh();
}

async function resetToday(domain: string) {
  const s = await loadState();
  const today = todayKey();
  const dayUsage = { ...(s.usage[today] ?? {}) };
  delete dayUsage[domain];
  const blocks = (s.dailyBlocks[today] ?? []).filter((d) => d !== domain);
  await saveState({
    usage: { ...s.usage, [today]: dayUsage },
    dailyBlocks: { ...s.dailyBlocks, [today]: blocks },
  });
  await refresh();
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const today = todayKey();
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatDateLong(d = new Date()) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
}
function fmtLong(isoKey: string): string {
  const [y, m, d] = isoKey.split("-").map(Number);
  if (!y || !m || !d) return isoKey;
  return `${d} ${MONTHS[m - 1]}, ${y}`;
}
const todayLong = formatDateLong();
const usage = computed(() => usageAll.value[today] ?? {});
const dailyBlocked = computed(() => blocksAll.value[today] ?? []);

const last7Days = computed(() => {
  const out: { key: string; label: string; date: string; total: number; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dateKey(d);
    const day = usageAll.value[k] ?? {};
    const total = Object.values(day).reduce((a, b) => a + b, 0);
    out.push({
      key: k,
      label: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()],
      date: pad(d.getDate()),
      total,
      isToday: i === 0,
    });
  }
  return out;
});

const totalToday = computed(() =>
  Object.values(usage.value).reduce((a, b) => a + b, 0),
);

const weeklyAvg = computed(() => {
  const totals = last7Days.value.map((d) => d.total);
  return totals.reduce((a, b) => a + b, 0) / totals.length;
});

const weeklyTotal = computed(() =>
  last7Days.value.reduce((a, b) => a + b.total, 0),
);

const peakDay = computed(() =>
  Math.max(1, ...last7Days.value.map((d) => d.total)),
);

const peakDayInfo = computed(() => {
  return last7Days.value.reduce(
    (m, d) => (d.total > m.total ? d : m),
    last7Days.value[0],
  );
});

const blocksToday = computed(() => dailyBlocked.value.length);

const blocksThisWeek = computed(() => {
  let count = 0;
  for (const d of last7Days.value) {
    count += (blocksAll.value[d.key] ?? []).length;
  }
  return count;
});

function fmtHM(seconds: number) {
  if (!seconds) return ["0", "m"] as const;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return [`${h}h ${pad(m)}`, "m"] as const;
  if (m > 0) return [`${m}`, "m"] as const;
  return [`${seconds}`, "s"] as const;
}
function fmtJoin(seconds: number) {
  const [n, u] = fmtHM(seconds);
  return `${n}${u}`;
}

const totalDisplay = computed(() => fmtHM(totalToday.value));
const avgDisplay = computed(() => fmtHM(Math.round(weeklyAvg.value)));
const weekDisplay = computed(() => fmtHM(weeklyTotal.value));

const trendVsAvg = computed(() => {
  if (weeklyAvg.value === 0) return 0;
  return Math.round(((totalToday.value - weeklyAvg.value) / weeklyAvg.value) * 100);
});

const sortedRules = computed(() =>
  [...rules.value].sort((a, b) => {
    const ua = usage.value[a.domain] ?? 0;
    const ub = usage.value[b.domain] ?? 0;
    return ub - ua;
  }),
);

const topToday = computed(() =>
  Object.entries(usage.value)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3),
);

function ruleStatus(r: BlockRule): "limit" | "over" | "hard" {
  if (!r.timeLimitMinutes) return "hard";
  const u = usage.value[r.domain] ?? 0;
  return u >= r.timeLimitMinutes * 60 ? "over" : "limit";
}

function rulePct(r: BlockRule): number {
  if (!r.timeLimitMinutes) return 100;
  const u = usage.value[r.domain] ?? 0;
  return Math.min(100, (u / (r.timeLimitMinutes * 60)) * 100);
}

function ruleRemaining(r: BlockRule): number {
  if (!r.timeLimitMinutes) return 0;
  const u = usage.value[r.domain] ?? 0;
  return r.timeLimitMinutes * 60 - u;
}

const tabs: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "sites", label: "Sites" },
  { id: "trends", label: "Trends" },
];
</script>

<template>
  <div class="app">
    <header class="head">
      <div class="kicker">
        <span class="dot" />
        <span>TIMELOCK</span>
      </div>
      <div class="date">{{ todayLong }}</div>
    </header>

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

    <!-- ─── TODAY ─────────────────────────────────────── -->
    <section v-if="tab === 'today'" class="panel">
      <div class="hero">
        <div class="eyebrow">SCREEN TIME · TRACKED</div>
        <div class="hero-num">
          <span class="num">{{ totalDisplay[0] }}</span>
          <span class="unit">{{ totalDisplay[1] }}</span>
        </div>
        <div class="hero-trend" v-if="weeklyAvg > 0">
          <span :class="['trend', trendVsAvg <= 0 ? 'good' : 'bad']">
            {{ trendVsAvg > 0 ? "▲" : "▼" }} {{ Math.abs(trendVsAvg) }}%
          </span>
          <span class="vs">vs 7-day avg · {{ avgDisplay[0] }}{{ avgDisplay[1] }}</span>
        </div>
        <div v-else class="hero-trend">
          <span class="vs">no history yet</span>
        </div>
      </div>

      <div class="divider" />

      <div class="section-h">
        <span class="bar-h" /><span>TOP SITES TODAY</span>
      </div>
      <ul v-if="topToday.length" class="top-list">
        <li v-for="([host, sec], i) in topToday" :key="host">
          <span class="rank">{{ pad(i + 1) }}</span>
          <span class="top-domain" :title="host">{{ host }}</span>
          <span class="top-time">{{ fmtJoin(sec) }}</span>
        </li>
      </ul>
      <p v-else class="muted-line">No tracked activity yet today.</p>

      <div class="divider" />

      <div class="section-h">
        <span class="bar-h" /><span>BLOCKED TODAY</span>
        <span class="section-meta">{{ blocksToday }}</span>
      </div>
      <ul v-if="dailyBlocked.length" class="chip-list">
        <li v-for="h in dailyBlocked" :key="h" class="chip">{{ h }}</li>
      </ul>
      <p v-else class="muted-line">Nothing blocked yet. Calm waters.</p>
    </section>

    <!-- ─── SITES ─────────────────────────────────────── -->
    <section v-if="tab === 'sites'" class="panel">
      <form class="add" @submit.prevent="addRule">
        <input
          v-model="newDomain"
          type="text"
          placeholder="domain (e.g. youtube.com)"
          autocomplete="off"
        />
        <input
          v-model.number="newLimit"
          type="number"
          min="1"
          placeholder="min"
        />
        <button type="submit">＋</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="hint-small">Leave minutes empty for a hard block.</p>

      <div class="divider" />

      <div class="section-h">
        <span class="bar-h" /><span>RULES</span>
        <span class="section-meta" v-if="sortedRules.length">
          {{ sortedRules.length }}
        </span>
      </div>

      <ul v-if="sortedRules.length" class="rules">
        <li
          v-for="r in sortedRules"
          :key="r.domain"
          :class="['rule', ruleStatus(r), { editing: editingDomain === r.domain }]"
        >
          <template v-if="editingDomain === r.domain">
            <form
              class="rule-edit"
              @submit.prevent="saveEdit(r.domain)"
            >
              <div class="rule-domain" :title="r.domain">{{ r.domain }}</div>
              <input
                v-model.number="editLimit"
                type="number"
                min="1"
                placeholder="min/day"
                class="edit-input"
                autofocus
              />
              <div class="rule-actions persistent">
                <button class="ghost ok" type="submit" title="Save">✓</button>
                <button class="ghost" type="button" @click="cancelEdit" title="Cancel">✕</button>
              </div>
            </form>
            <p class="edit-hint">Empty = hard block · number = daily minutes</p>
          </template>

          <template v-else>
            <div class="rule-row">
              <div class="rule-domain" :title="r.domain">{{ r.domain }}</div>
              <div class="rule-meta">
                <template v-if="r.timeLimitMinutes">
                  <span
                    v-if="ruleRemaining(r) > 0"
                    class="remaining"
                  >{{ fmtJoin(ruleRemaining(r)) }} left</span>
                  <span v-else class="remaining over-tag">
                    over by {{ fmtJoin(-ruleRemaining(r)) }}
                  </span>
                  <span class="sep">·</span>
                  <span class="usage">{{ fmtJoin(usage[r.domain] ?? 0) }}</span>
                  <span class="slash">/</span>
                  <span class="limit">{{ r.timeLimitMinutes }}m</span>
                </template>
                <template v-else>
                  <span class="hard-label">hard block</span>
                </template>
              </div>
              <div class="rule-actions">
                <button
                  class="ghost"
                  type="button"
                  @click="startEdit(r)"
                  title="Edit rule"
                >
                  ✎
                </button>
                <button
                  v-if="r.timeLimitMinutes"
                  class="ghost"
                  type="button"
                  @click="resetToday(r.domain)"
                  title="Reset today's usage"
                >
                  ↺
                </button>
                <button
                  class="ghost danger"
                  type="button"
                  @click="removeRule(r.domain)"
                  title="Remove rule"
                >
                  ✕
                </button>
              </div>
            </div>

            <div v-if="r.timeLimitMinutes" class="bar">
              <div class="bar-fill" :style="{ width: rulePct(r) + '%' }" />
            </div>
          </template>
        </li>
      </ul>

      <div v-else class="empty">
        <div class="empty-mark">∅</div>
        <p>No sites under watch.</p>
        <p class="empty-sub">Add a domain above to start.</p>
      </div>
    </section>

    <!-- ─── TRENDS ────────────────────────────────────── -->
    <section v-if="tab === 'trends'" class="panel">
      <div class="trend-grid">
        <div class="t-stat">
          <div class="t-num">{{ weekDisplay[0] }}<span class="t-unit">{{ weekDisplay[1] }}</span></div>
          <div class="t-lbl">7-day total</div>
        </div>
        <div class="t-stat">
          <div class="t-num">{{ avgDisplay[0] }}<span class="t-unit">{{ avgDisplay[1] }}</span></div>
          <div class="t-lbl">daily avg</div>
        </div>
        <div class="t-stat">
          <div class="t-num">{{ blocksThisWeek }}</div>
          <div class="t-lbl">blocks (7d)</div>
        </div>
      </div>

      <div class="divider" />

      <div class="section-h">
        <span class="bar-h" /><span>LAST 7 DAYS</span>
      </div>

      <div class="chart">
        <div
          v-for="d in last7Days"
          :key="d.key"
          class="chart-col"
          :class="{ today: d.isToday, empty: d.total === 0 }"
        >
          <div class="chart-val">{{ d.total ? fmtJoin(d.total) : "—" }}</div>
          <div class="chart-bar-wrap">
            <div
              class="chart-bar"
              :style="{ height: Math.max(2, (d.total / peakDay) * 100) + '%' }"
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
      <p class="muted-line" v-if="peakDayInfo && peakDayInfo.total > 0">
        Heaviest day was <span class="ink">{{ fmtLong(peakDayInfo.key) }}</span> ·
        <span class="ink">{{ fmtJoin(peakDayInfo.total) }}</span>
      </p>
      <p class="muted-line" v-else>No history yet — check back tomorrow.</p>
    </section>

    <footer class="foot">
      <span>Attention is currency.</span>
      <span class="foot-r">spend it well</span>
    </footer>
  </div>
</template>

<style scoped>
.app {
  width: 380px;
  padding: 16px 18px 14px;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  color: var(--ink);
  background: var(--paper);
}

/* ── header ─────────────────────────────────────────────── */
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--ink-dim);
}
.kicker {
  display: flex;
  align-items: center;
  gap: 8px;
}
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

/* ── tabs ───────────────────────────────────────────────── */
.tabs {
  display: flex;
  gap: 0;
  margin-top: 14px;
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
  padding: 10px 0;
  cursor: pointer;
  transition: color 0.15s;
  margin-bottom: -1px;
}
.tab:hover {
  color: var(--ink);
  background: transparent;
}
.tab.active {
  color: var(--ink);
  border-bottom-color: var(--accent);
}
.tab.active:hover {
  color: var(--ink);
  background: transparent;
}

/* ── panel ──────────────────────────────────────────────── */
.panel {
  padding-top: 18px;
  animation: fade 0.25s ease;
}
@keyframes fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

.divider {
  height: 1px;
  background: var(--rule);
  margin: 18px 0;
}

.section-h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--ink-dim);
  margin-bottom: 12px;
}
.section-h .bar-h {
  width: 12px;
  height: 1px;
  background: var(--accent);
}
.section-meta {
  margin-left: auto;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.muted-line {
  color: var(--ink-faint);
  font-size: 11px;
  margin: 4px 0;
  letter-spacing: 0.02em;
}
.muted-line .ink {
  color: var(--ink);
}

/* ── hero ───────────────────────────────────────────────── */
.hero {
  padding: 4px 0 4px;
}
.eyebrow {
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--ink-faint);
  margin-bottom: 6px;
}
.hero-num {
  font-family: "Newsreader", serif;
  font-variation-settings: "opsz" 72;
  font-weight: 600;
  line-height: 0.9;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.hero-num .num {
  font-size: 72px;
  letter-spacing: -0.035em;
}
.hero-num .unit {
  font-family: "IBM Plex Mono", monospace;
  font-size: 18px;
  color: var(--ink-dim);
  font-weight: 500;
}
.hero-trend {
  margin-top: 10px;
  font-size: 10.5px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-faint);
}
.trend.good { color: var(--good); }
.trend.bad { color: var(--accent); }
.vs { font-variant-numeric: tabular-nums; }

/* ── top sites list ─────────────────────────────────────── */
.top-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.top-list li {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px dashed var(--rule);
  font-size: 12px;
}
.top-list li:first-child { border-top: none; padding-top: 2px; }
.rank {
  color: var(--ink-faint);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.top-domain {
  font-family: "Newsreader", serif;
  font-style: italic;
  font-weight: 600;
  font-size: 15px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  color: var(--ink);
}
.top-time {
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

/* ── chip list (blocked today) ──────────────────────────── */
.chip-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font-size: 11px;
  padding: 4px 8px;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid transparent;
  letter-spacing: 0;
}

/* ── add form ───────────────────────────────────────────── */
.add {
  display: grid;
  grid-template-columns: 1fr 70px 36px;
  gap: 6px;
}
input {
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 10px;
  color: inherit;
  font: 500 12px "IBM Plex Mono", monospace;
  outline: none;
  min-width: 0;
}
input::placeholder { color: var(--ink-faint); }
input:focus {
  border-color: var(--accent);
  background: var(--paper-3);
}
button {
  background: var(--accent);
  color: var(--paper);
  border: none;
  border-radius: 2px;
  font: 700 16px "Newsreader", serif;
  cursor: pointer;
  transition: background 0.15s;
}
button:hover { background: #94afba; }
.ghost {
  background: transparent;
  color: var(--ink-faint);
  padding: 2px 6px;
  font-size: 14px;
}
.ghost:hover { color: var(--ink); background: transparent; }
.ghost.danger:hover { color: var(--accent); }
.error {
  color: var(--accent);
  margin: 10px 0 0;
  font-size: 10px;
  letter-spacing: 0.08em;
}
.hint-small {
  margin: 8px 0 0;
  font-size: 10px;
  color: var(--ink-faint);
}

/* ── rules list ─────────────────────────────────────────── */
.rules {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.rule {
  padding: 12px 0 14px;
  border-top: 1px solid var(--rule);
}
.rule:first-child {
  border-top: none;
  padding-top: 4px;
}
.rule-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
}
.rule-domain {
  font-family: "Newsreader", serif;
  font-weight: 500;
  font-size: 15px;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  color: var(--ink);
  line-height: 1.2;
}
.rule.over .rule-domain { color: var(--accent); }
.rule-meta {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.remaining {
  color: var(--ink);
  font-weight: 500;
}
.remaining.over-tag { color: var(--accent); }
.sep { color: var(--ink-faint); }
.usage {
  color: var(--ink-dim);
  font-weight: 400;
}
.rule.over .usage { color: var(--accent); }
.slash { color: var(--ink-faint); }
.limit { color: var(--ink-faint); }
.hard-label {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.rule-actions {
  display: flex;
  gap: 0;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.rule:hover .rule-actions,
.rule-actions.persistent { opacity: 1; }
.ghost.ok { color: var(--accent); }
.ghost.ok:hover { color: var(--ink); }

/* inline edit */
.rule.editing { padding-bottom: 12px; }
.rule-edit {
  display: grid;
  grid-template-columns: 1fr 88px auto;
  align-items: center;
  gap: 10px;
}
.edit-input {
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 6px 8px;
  color: inherit;
  font: 500 12px "IBM Plex Mono", monospace;
  outline: none;
  min-width: 0;
}
.edit-input:focus {
  border-color: var(--accent);
  background: var(--paper-3);
}
.edit-hint {
  margin: 8px 0 0;
  font-size: 9.5px;
  color: var(--ink-faint);
  letter-spacing: 0.04em;
}
.bar {
  margin-top: 10px;
  height: 2px;
  background: var(--rule);
  position: relative;
  overflow: hidden;
}
.bar-fill {
  position: absolute;
  inset: 0;
  width: 0;
  background: var(--ink-dim);
  transition: width 0.4s ease;
}
.rule.over .bar-fill { background: var(--accent); }

/* ── empty ──────────────────────────────────────────────── */
.empty {
  text-align: center;
  padding: 28px 0;
  color: var(--ink-faint);
}
.empty-mark {
  font-family: "Newsreader", serif;
  font-size: 38px;
  color: var(--rule);
}
.empty p { margin: 4px 0; font-size: 11px; }
.empty-sub { color: var(--ink-faint); }

/* ── trends ─────────────────────────────────────────────── */
.trend-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
}
.t-stat {
  background: var(--paper);
  padding: 12px 10px;
}
.t-num {
  font-family: "Newsreader", serif;
  font-weight: 600;
  font-size: 22px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.t-unit {
  font-family: "IBM Plex Mono", monospace;
  font-size: 11px;
  color: var(--ink-dim);
  margin-left: 2px;
  font-weight: 500;
}
.t-lbl {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
  margin-top: 6px;
}

/* trends chart */
.chart {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  align-items: end;
  height: 130px;
}
.chart-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  position: relative;
  padding-bottom: 28px;
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
.chart-val {
  font-size: 9px;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-dim);
}
.chart-col.today .chart-val { color: var(--accent); font-weight: 600; }
.chart-day {
  position: absolute;
  bottom: 12px;
  font-size: 9px;
  letter-spacing: 0.1em;
}
.chart-date {
  position: absolute;
  bottom: 0;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}
.chart-col.today .chart-day,
.chart-col.today .chart-date { color: var(--ink); }

/* ── footer ─────────────────────────────────────────────── */
.foot {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
  display: flex;
  justify-content: space-between;
  font-family: "Newsreader", serif;
  font-style: italic;
  font-size: 11px;
  color: var(--ink-faint);
}
.foot-r { color: var(--ink-dim); }
</style>
