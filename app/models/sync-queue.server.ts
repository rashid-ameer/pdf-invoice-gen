import { runSyncOrdersJob } from "./order-sync.server";

/**
 * Sync enqueue modes.
 * Group 8 uses in-process fire-and-forget only (no Redis/BullMQ).
 * Keep this API so a future Redis path can return 'queued' without rewriting callers.
 */
export type SyncEnqueueMode = "queued" | "background";

/**
 * Enqueue order sync without awaiting the full run in the HTTP request.
 * Currently always returns 'background' (old Redis-down fallback).
 * Future: if Redis/BullMQ is connected, enqueue and return 'queued'.
 */
export async function enqueueSyncOrders(
  shopDomain: string,
): Promise<SyncEnqueueMode> {
  // Intentionally not awaited — fire-and-forget (old parity without Redis).
  void runSyncOrdersJob(shopDomain).catch((error) => {
    console.error("[sync-queue] background order sync failed:", error);
  });
  return "background";
}
