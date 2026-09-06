import "server-only";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_KEY = 5;
const MAX_GLOBAL_REQUESTS_PER_WINDOW = 100;
const MAX_CONCURRENT_GENERATIONS = 4;

interface RateBucket {
  startedAt: number;
  count: number;
}

declare global {
  var swuQrRateBuckets: Map<string, RateBucket> | undefined;
  var swuQrGenerationCount: number | undefined;
}

const buckets = globalThis.swuQrRateBuckets ?? new Map<string, RateBucket>();
globalThis.swuQrRateBuckets = buckets;
globalThis.swuQrGenerationCount ??= 0;

function consumeBucket(key: string, limit: number, now: number) {
  const existing = buckets.get(key);
  const bucket = !existing || now - existing.startedAt >= RATE_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : existing;
  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket.count <= limit;
}

function clientKey(sessionId: string | undefined) {
  return sessionId ? `client:${sessionId}` : undefined;
}

export interface RateLimitLease {
  release: () => void;
}

export function acquireQrGenerationLease(
  request: Request,
  sessionId: string | undefined,
  now = Date.now(),
): RateLimitLease | undefined {
  void request;
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) buckets.delete(key);
  }

  const key = clientKey(sessionId);
  if (
    (key && !consumeBucket(key, MAX_REQUESTS_PER_KEY, now)) ||
    !consumeBucket("global", MAX_GLOBAL_REQUESTS_PER_WINDOW, now) ||
    (globalThis.swuQrGenerationCount ?? 0) >= MAX_CONCURRENT_GENERATIONS
  ) {
    return undefined;
  }

  globalThis.swuQrGenerationCount = (globalThis.swuQrGenerationCount ?? 0) + 1;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      globalThis.swuQrGenerationCount = Math.max(0, (globalThis.swuQrGenerationCount ?? 1) - 1);
    },
  };
}

/** @internal 仅用于隔离测试状态。 */
export function resetQrRateLimitForTests() {
  buckets.clear();
  globalThis.swuQrGenerationCount = 0;
}
