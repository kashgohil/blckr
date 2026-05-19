<script lang="ts" setup>
import { onMounted, ref, computed } from "vue";
import {
  loadState,
  saveState,
  normalizeDomain,
  todayKey,
  type BlockRule,
} from "@/utils/blocker";

const rules = ref<BlockRule[]>([]);
const usage = ref<Record<string, number>>({});
const dailyBlocked = ref<string[]>([]);

const newDomain = ref("");
const newLimit = ref<number | null>(null);
const error = ref("");

async function refresh() {
  const s = await loadState();
  rules.value = s.rules;
  usage.value = s.usage[todayKey()] ?? {};
  dailyBlocked.value = s.dailyBlocks[todayKey()] ?? [];
}

onMounted(refresh);

async function addRule() {
  error.value = "";
  const domain = normalizeDomain(newDomain.value);
  if (!domain) {
    error.value = "Enter a valid domain";
    return;
  }
  if (rules.value.some((r) => r.domain === domain)) {
    error.value = "Already in the list";
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

function formatTime(seconds: number): string {
  if (!seconds) return "0m";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m`;
}

const sortedRules = computed(() =>
  [...rules.value].sort((a, b) => a.domain.localeCompare(b.domain)),
);
</script>

<template>
  <div class="app">
    <header>
      <h1>Blckr</h1>
      <p>Block distracting sites and set daily time limits.</p>
    </header>

    <form class="add" @submit.prevent="addRule">
      <input
        v-model="newDomain"
        type="text"
        placeholder="e.g. youtube.com"
        autocomplete="off"
      />
      <input
        v-model.number="newLimit"
        type="number"
        min="1"
        placeholder="min/day"
      />
      <button type="submit">Add</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>

    <ul v-if="sortedRules.length" class="rules">
      <li v-for="r in sortedRules" :key="r.domain">
        <div class="row">
          <div class="info">
            <div class="domain">{{ r.domain }}</div>
            <div class="meta">
              <template v-if="r.timeLimitMinutes">
                {{ formatTime(usage[r.domain] ?? 0) }} /
                {{ r.timeLimitMinutes }}m today
                <span v-if="dailyBlocked.includes(r.domain)" class="tag">
                  blocked today
                </span>
              </template>
              <template v-else>
                <span class="tag hard">always blocked</span>
              </template>
            </div>
            <div
              v-if="r.timeLimitMinutes"
              class="bar"
              :style="{
                '--pct':
                  Math.min(
                    100,
                    ((usage[r.domain] ?? 0) / (r.timeLimitMinutes * 60)) * 100,
                  ) + '%',
              }"
            />
          </div>
          <div class="actions">
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
            >
              ✕
            </button>
          </div>
        </div>
      </li>
    </ul>
    <p v-else class="empty">No sites blocked yet.</p>
  </div>
</template>

<style scoped>
.app {
  width: 340px;
  padding: 16px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #f5f5f7;
  background: #0e1019;
}
header h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}
header p {
  margin: 2px 0 14px;
  color: #8a8e9e;
  font-size: 0.8rem;
}
.add {
  display: grid;
  grid-template-columns: 1fr 90px auto;
  gap: 6px;
}
input {
  background: #1a1d2c;
  border: 1px solid #2a2e40;
  border-radius: 8px;
  padding: 8px 10px;
  color: inherit;
  font-size: 0.85rem;
  outline: none;
  min-width: 0;
}
input:focus {
  border-color: #5b6cff;
}
button {
  background: #5b6cff;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.85rem;
}
button:hover {
  background: #6d7cff;
}
.ghost {
  background: transparent;
  color: #8a8e9e;
  padding: 4px 8px;
}
.ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f5f5f7;
}
.ghost.danger:hover {
  color: #ff7676;
}
.error {
  color: #ff7676;
  margin: 8px 0 0;
  font-size: 0.8rem;
}
.rules {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #161a28;
  border: 1px solid #232739;
  border-radius: 10px;
}
.info {
  flex: 1;
  min-width: 0;
}
.domain {
  font-weight: 600;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  font-size: 0.75rem;
  color: #8a8e9e;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tag {
  background: rgba(255, 118, 118, 0.15);
  color: #ff9b9b;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.7rem;
}
.tag.hard {
  background: rgba(91, 108, 255, 0.18);
  color: #aab3ff;
}
.bar {
  margin-top: 6px;
  height: 4px;
  border-radius: 2px;
  background: #232739;
  position: relative;
  overflow: hidden;
}
.bar::after {
  content: "";
  position: absolute;
  inset: 0;
  width: var(--pct, 0%);
  background: linear-gradient(90deg, #5b6cff, #ff7676);
  border-radius: 2px;
  transition: width 0.3s ease;
}
.actions {
  display: flex;
  gap: 2px;
}
.empty {
  color: #6e7286;
  font-size: 0.85rem;
  text-align: center;
  margin: 24px 0 8px;
}
</style>
