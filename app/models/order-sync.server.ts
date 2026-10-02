import prisma from "../db.server";
import { normalizeFinancialStatus } from "../utils/csv";
import { createInvoiceFromShopifyOrder } from "./invoice-create.server";
import { fetchRecentOrders } from "./shopify-admin-graphql.server";
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

export type SyncOrdersSuccess = {
  ok: true;
  fetched: number;
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
  needsReauth: false;
};

export type SyncOrdersFailure = {
  ok: false;
  error: string;
  needsReauth: boolean;
};

export type SyncOrdersResult = SyncOrdersSuccess | SyncOrdersFailure;

export type SyncOrdersDeps = {
  fetchRecentOrders?: typeof fetchRecentOrders;
  getOfflineAccessTokenForShop?: typeof getOfflineAccessTokenForShop;
};

export async function syncOrdersForShop(
  shopDomain: string,
  limit = 50,
  deps: SyncOrdersDeps = {},
): Promise<SyncOrdersResult> {
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

  const fetchOrders = deps.fetchRecentOrders ?? fetchRecentOrders;

  try {
    const orders = await fetchOrders(shopDomain, limit);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    const orderIds = orders.map((order) => String(order.id));
    const existingRows = orderIds.length
      ? await prisma.invoice.findMany({
          where: {
            storeId: store.id,
            shopifyOrderId: { in: orderIds },
          },
          select: { shopifyOrderId: true },
        })
      : [];
    const existingOrderIds = new Set(
      existingRows.map((row) => row.shopifyOrderId),
    );

    for (const order of orders) {
      try {
        if (existingOrderIds.has(String(order.id))) {
          if (order.financial_status) {
            await prisma.invoice.updateMany({
              where: {
                storeId: store.id,
                shopifyOrderId: String(order.id),
              },
              data: {
                financialStatus: normalizeFinancialStatus(
                  order.financial_status,
                ),
              },
            });
          }
          skipped += 1;
          continue;
        }
        await createInvoiceFromShopifyOrder(shopDomain, order, "sync");
        created += 1;
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`${order.name}: ${message}`);
        console.error(`[sync] failed for order ${order.name}:`, error);
      }
    }

    return {
      ok: true as const,
      fetched: orders.length,
      created,
      skipped,
      failed,
      errors: errors.slice(0, 5),
      needsReauth: false,
    };
  } catch (error) {
    console.error("[sync] Shopify API error:", error);
    if (isUnauthorizedError(error)) {
      return { ok: false as const, error: REAUTH_HINT, needsReauth: true };
    }
    const message =
      error instanceof Error ? error.message : "Failed to sync orders";
    return { ok: false as const, error: message, needsReauth: false };
  }
}

/** Job runner used by enqueue (and future Redis workers). */
export async function runSyncOrdersJob(shopDomain: string) {
  const result = await syncOrdersForShop(shopDomain);
  if (result.ok && result.created > 0) {
    await invalidateDashboardCacheForShop(shopDomain);
  }
  return result;
}
