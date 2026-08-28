import { loadStoredJson, saveStoredJson } from "./storage";

const RATE_KEY = "rate-limits.json";
const MAX_KEYS_PER_BUCKET = 2000;

const MINUTE = 60 * 1000;

/**
 * Every limiter is declared here so pruning can use each bucket's own window.
 * Login buckets record failures only; the rest are consumed per request.
 */
export const RATE_LIMITS = {
  loginEmailIp: { limit: 5, windowMs: 15 * MINUTE },
  loginIp: { limit: 20, windowMs: 15 * MINUTE },
  uploadIp: { limit: 30, windowMs: 15 * MINUTE },
  submissionIp: { limit: 10, windowMs: 60 * MINUTE },
  changePasswordAccount: { limit: 10, windowMs: 15 * MINUTE },
  adminWriteAccount: { limit: 20, windowMs: 60 * MINUTE },
} as const;

export type RateBucket = keyof typeof RATE_LIMITS;

/** bucket -> key -> hit timestamps (ms). */
type RateState = Partial<Record<RateBucket, Record<string, number[]>>>;

/**
 * Warm-instance mirror of the persisted state. Blobs writes are read-modify-write,
 * so concurrent invocations can drop each other's hits; keeping the counts in
 * memory as well means a burst hitting one warm instance is still caught.
 */
let memory: RateState = {};

function isTimestampList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

function readState(value: unknown): RateState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const state: RateState = {};
  for (const bucket of Object.keys(RATE_LIMITS) as RateBucket[]) {
    const keys = source[bucket];
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) continue;
    const entries: Record<string, number[]> = {};
    for (const [key, times] of Object.entries(keys as Record<string, unknown>)) {
      if (isTimestampList(times)) entries[key] = times;
    }
    state[bucket] = entries;
  }
  return state;
}

function mergeHits(persisted: number[], cached: number[]): number[] {
  const seen = new Set(persisted);
  return [...persisted, ...cached.filter((time) => !seen.has(time))];
}

/** Drop expired hits per bucket window and cap keys so the blob cannot grow without bound. */
function pruneState(state: RateState, now: number): RateState {
  const next: RateState = {};
  for (const bucket of Object.keys(RATE_LIMITS) as RateBucket[]) {
    const keys = state[bucket];
    if (!keys) continue;
    const { windowMs } = RATE_LIMITS[bucket];
    const entries: Record<string, number[]> = {};
    for (const [key, times] of Object.entries(keys)) {
      const kept = times.filter((time) => now - time < windowMs);
      if (kept.length > 0) entries[key] = kept;
    }
    const names = Object.keys(entries);
    if (names.length > MAX_KEYS_PER_BUCKET) {
      // Evict the keys whose most recent hit is oldest.
      names
        .sort((a, b) => Math.max(...entries[b]!) - Math.max(...entries[a]!))
        .slice(MAX_KEYS_PER_BUCKET)
        .forEach((name) => delete entries[name]);
    }
    if (Object.keys(entries).length > 0) next[bucket] = entries;
  }
  return next;
}

async function loadState(now: number): Promise<RateState> {
  const persisted = readState(await loadStoredJson<unknown>(RATE_KEY, {}));
  for (const bucket of Object.keys(memory) as RateBucket[]) {
    const cached = memory[bucket];
    if (!cached) continue;
    const target = (persisted[bucket] ??= {});
    for (const [key, times] of Object.entries(cached)) {
      target[key] = mergeHits(target[key] ?? [], times);
    }
  }
  const pruned = pruneState(persisted, now);
  memory = structuredClone(pruned);
  return pruned;
}

function remember(state: RateState, bucket: RateBucket, key: string, times: number[]): void {
  (state[bucket] ??= {})[key] = [...times];
  (memory[bucket] ??= {})[key] = [...times];
}

export async function isRateLimited(bucket: RateBucket, key: string): Promise<boolean> {
  const state = await loadState(Date.now());
  return (state[bucket]?.[key]?.length ?? 0) >= RATE_LIMITS[bucket].limit;
}

export async function recordHit(bucket: RateBucket, key: string): Promise<void> {
  const now = Date.now();
  const state = await loadState(now);
  remember(state, bucket, key, [...(state[bucket]?.[key] ?? []), now]);
  await saveStoredJson(RATE_KEY, state);
}

/**
 * Record a hit and report whether the caller was still under the limit.
 * Returns true when the request should be allowed.
 */
export async function consume(bucket: RateBucket, key: string): Promise<boolean> {
  const now = Date.now();
  const state = await loadState(now);
  const hits = state[bucket]?.[key] ?? [];
  const allowed = hits.length < RATE_LIMITS[bucket].limit;
  remember(state, bucket, key, [...hits, now]);
  await saveStoredJson(RATE_KEY, state);
  return allowed;
}

export function tooManyRequests(message = "Too many requests. Try again later."): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
