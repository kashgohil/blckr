<script lang="ts" setup>
import { computed } from "vue";

const params = new URLSearchParams(window.location.search);
const host = params.get("host") ?? "this site";
const reason = params.get("reason") ?? "blocked";

const title = computed(() =>
  reason === "timeup" ? "Time's up for today" : "You are blocked from this site",
);

const message = computed(() =>
  reason === "timeup"
    ? `You've spent your daily time budget on ${host}. It will be available again tomorrow.`
    : `Access to ${host} is blocked by Blckr.`,
);
</script>

<template>
  <main class="card">
    <div class="icon">⛔</div>
    <h1>{{ title }}</h1>
    <p class="host">{{ host }}</p>
    <p class="message">{{ message }}</p>
    <p class="hint">Take a breath. Get back to what matters.</p>
  </main>
</template>

<style scoped>
.card {
  max-width: 520px;
  text-align: center;
  padding: 3rem 2.5rem;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.icon {
  font-size: 3.5rem;
  margin-bottom: 0.75rem;
}
h1 {
  font-size: 1.8rem;
  margin: 0 0 0.75rem;
  font-weight: 600;
}
.host {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #ff7676;
  margin: 0 0 1.25rem;
  font-size: 1rem;
}
.message {
  color: #c4c7d4;
  line-height: 1.55;
  margin: 0 0 1.5rem;
}
.hint {
  color: #6e7286;
  font-size: 0.9rem;
  margin: 0;
}
</style>
