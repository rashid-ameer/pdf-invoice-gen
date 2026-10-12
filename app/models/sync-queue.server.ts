import { waitUntil } from "@vercel/functions";
import { runSyncOrdersJob } from "./order-sync.server";
import { runSyncRefundsJob } from "./refund-sync.server";

/**
 * Sync enqueue modes.
 * No Redis/BullMQ — sync runs in-process.
 * Keep this API so a future Redis path can return 'queued' without rewriting callers.
 */
export type SyncEnqueueMode = "queued" | "background";

/**
 * Run sync work for the current request.
 *
 * On Vercel serverless, a bare `void promise` is frozen as soon as the HTTP
 * response is sent — that caused Sync orders to stop after ~1 invoice.
 * We both await (so the action cannot finish early) and waitUntil (so any
 * platform-level early response still keeps the function alive).
 */
async function runSyncWork(work: Promise<unknown>): Promise<void> {
  waitUntil(work);
  await work;
}

/**
 * Run order sync for a shop.
 * Currently always returns 'background' (old Redis-down fallback).
 * Future: if Redis/BullMQ is connected, enqueue and return 'queued'.
 */
export async function enqueueSyncOrders(
  shopDomain: string,
): Promise<SyncEnqueueMode> {
  await runSyncWork(
    runSyncOrdersJob(shopDomain).catch((error) => {
      console.error("[sync-queue] order sync failed:", error);
    }),
  );
  return "background";
}

/**
 * Run refund sync for a shop.
 * Same in-process pattern as enqueueSyncOrders (no Redis/BullMQ).
 */
export async function enqueueSyncRefunds(
  shopDomain: string,
): Promise<SyncEnqueueMode> {
  await runSyncWork(
    runSyncRefundsJob(shopDomain).catch((error) => {
      console.error("[sync-queue] refund sync failed:", error);
    }),
  );
  return "background";
}
