import prisma from "../db.server";
import { mapWithConcurrency } from "../utils/concurrency";
import { createCreditNoteFromRefund } from "./credit-note.server";
import type { ShopifyRefund } from "./credit-note.server";
import { fetchOrderRefunds } from "./shopify-admin-graphql.server";
import { getOfflineAccessTokenForShop } from "./shopify-offline-session.server";
import { invalidateDashboardCacheForShop } from "./dashboard-cache.server";

function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    response?: { code?: number; statusCode?: number };
    code?: number;
    statusCode?: number;
    message?: string;
  };
  const code =
    err.response?.code ??
    err.response?.statusCode ??
    err.code ??
    err.statusCode;
  if (code === 401 || code === 403) return true;
  return (
    typeof err.message === "string" &&
    /401|403|Unauthorized|Forbidden|Invalid API key or access token|Non-expiring access tokens/i.test(
      err.message,
    )
  );
}

const REAUTH_HINT =
  "Shopify access token is invalid or expired. Click Re-authorize app (or reinstall) so a fresh token is issued. Also confirm SHOPIFY_API_KEY / SHOPIFY_API_SECRET match the Partner app that installed this store.";

/** Old syncRefundsForShop default: last 40 invoices. */
export const SYNC_REFUNDS_DEFAULT_LIMIT = 40;

export type SyncRefundsSuccess = {
  ok: true;
  fetched: number;
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
  needsReauth: false;
};

export type SyncRefundsFailure = {
  ok: false;
  error: string;
  needsReauth: boolean;
};

export type SyncRefundsResult = SyncRefundsSuccess | SyncRefundsFailure;

export type SyncRefundsDeps = {
  fetchOrderRefunds?: typeof fetchOrderRefunds;
  getOfflineAccessTokenForShop?: typeof getOfflineAccessTokenForShop;
};

/**
 * Sync refunds for recent invoices → credit notes (old syncRefundsForShop).
 * Limit defaults to 40. Existing refund IDs are skipped; create uses source "sync".
 */
export async function syncRefundsForShop(
  shopDomain: string,
  limit = SYNC_REFUNDS_DEFAULT_LIMIT,
  deps: SyncRefundsDeps = {},
): Promise<SyncRefundsResult> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) {
    return { ok: false as const, error: "Store not found", needsReauth: false };
  }

  const resolveToken =
    deps.getOfflineAccessTokenForShop ?? getOfflineAccessTokenForShop;
  const sessionToken = await resolveToken(shopDomain);
  if (!sessionToken) {
    return {
      ok: false as const,
      error: "Shopify session missing. Re-authorize the app from Shopify Admin.",
      needsReauth: true,
    };
  }

  const fetchRefunds = deps.fetchOrderRefunds ?? fetchOrderRefunds;

  const invoices = await prisma.invoice.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { shopifyOrderId: true, invoiceNumber: true },
  });

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let fetched = 0;
  const errors: string[] = [];

  try {
    const invoicesWithOrders = invoices.filter((invoice) => invoice.shopifyOrderId);

    const perInvoiceResults = await mapWithConcurrency(
      invoicesWithOrders,
      5,
      async (invoice) => {
        const local = {
          fetched: 0,
          created: 0,
          skipped: 0,
          failed: 0,
          errors: [] as string[],
        };

        try {
          const refunds = await fetchRefunds(
            shopDomain,
            String(invoice.shopifyOrderId),
          );
          local.fetched += refunds.length;

          if (refunds.length === 0) return local;

          const refundIds = refunds.map((refund) => String(refund.id));
          const existingRows = await prisma.creditNote.findMany({
            where: {
              storeId: store.id,
              shopifyRefundId: { in: refundIds },
            },
            select: { shopifyRefundId: true },
          });
          const existingRefundIds = new Set(
            existingRows.map((row) => row.shopifyRefundId),
          );

          for (const refund of refunds) {
            try {
              if (existingRefundIds.has(String(refund.id))) {
                local.skipped += 1;
                continue;
              }
              const note = await createCreditNoteFromRefund(
                shopDomain,
                refund,
                "sync",
              );
              if (note) local.created += 1;
              else local.skipped += 1;
            } catch (error) {
              local.failed += 1;
              const message =
                error instanceof Error ? error.message : "Unknown error";
              local.errors.push(`${invoice.invoiceNumber}: ${message}`);
              console.error(
                `[sync-refunds] failed for invoice ${invoice.invoiceNumber} refund ${refund.id}:`,
                message,
              );
            }
          }
        } catch (error) {
          if (isUnauthorizedError(error)) {
            throw error;
          }
          local.failed += 1;
          const message =
            error instanceof Error ? error.message : "Unknown error";
          local.errors.push(`Order ${invoice.shopifyOrderId}: ${message}`);
          console.error(
            `[sync-refunds] failed for order ${invoice.shopifyOrderId}:`,
            message,
          );
        }

        return local;
      },
    );

    for (const result of perInvoiceResults) {
      fetched += result.fetched;
      created += result.created;
      skipped += result.skipped;
      failed += result.failed;
      errors.push(...result.errors);
    }

    return {
      ok: true as const,
      fetched,
      created,
      skipped,
      failed,
      errors: errors.slice(0, 5),
      needsReauth: false,
    };
  } catch (error) {
    console.error("[sync-refunds] Shopify API error:", error);
    if (isUnauthorizedError(error)) {
      return { ok: false as const, error: REAUTH_HINT, needsReauth: true };
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync refunds";
    return { ok: false as const, error: message, needsReauth: false };
  }
}

/** Job runner used by enqueueSyncRefunds (and future Redis workers). */
export async function runSyncRefundsJob(shopDomain: string) {
  const result = await syncRefundsForShop(shopDomain);
  if (result.ok && result.created > 0) {
    await invalidateDashboardCacheForShop(shopDomain);
  }
  return result;
}

/** Test helper type re-export. */
export type { ShopifyRefund };
