export interface BlockRule {
  domain: string;
  timeLimitMinutes?: number;
}

export interface BlockerState {
  rules: BlockRule[];
  usage: Record<string, Record<string, number>>;
  dailyBlocks: Record<string, string[]>;
}

export const DEFAULT_STATE: BlockerState = {
  rules: [],
  usage: {},
  dailyBlocks: {},
};

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let host = trimmed;
  try {
    if (trimmed.includes("://")) host = new URL(trimmed).hostname;
    else host = new URL(`http://${trimmed}`).hostname;
  } catch {
    return null;
  }
  return host.replace(/^www\./, "");
}

export function hostnameFromUrl(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function matchRule(host: string, rules: BlockRule[]): BlockRule | null {
  for (const r of rules) {
    if (host === r.domain || host.endsWith(`.${r.domain}`)) return r;
  }
  return null;
}

export async function loadState(): Promise<BlockerState> {
  const raw = (await browser.storage.local.get(DEFAULT_STATE)) as BlockerState;
  return {
    rules: raw.rules ?? [],
    usage: raw.usage ?? {},
    dailyBlocks: raw.dailyBlocks ?? {},
  };
}

export async function saveState(patch: Partial<BlockerState>): Promise<void> {
  await browser.storage.local.set(patch);
}

export function getTodaySeconds(state: BlockerState, host: string): number {
  return state.usage[todayKey()]?.[host] ?? 0;
}
