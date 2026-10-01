import { createHash } from "node:crypto";

/** In-process PDF buffer cache (Group 7). Isolated for a future external backend. */
const memoryCache = new Map<string, { expiresAt: number; value: Buffer }>();
const MEMORY_CACHE_MAX = 48;

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function getMemoryCachedBuffer(key: string): Buffer | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

export function setMemoryCachedBuffer(
  key: string,
  value: Buffer,
  ttlSeconds: number,
): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/** Test helper */
export function clearPdfMemoryCacheForTests() {
  memoryCache.clear();
}
