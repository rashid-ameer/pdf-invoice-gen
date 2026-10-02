import prisma from "../db.server";
import { normalizeFinancialStatus } from "../utils/csv";
import { getOfflineAccessTokenForShop } from "./shopify-offline-session.server";

type GraphqlOrderNode = {
  id?: string;
  displayFinancialStatus?: string | null;
};

function orderGid(id: string): string {
  const trimmed = String(id || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Order/${trimmed}`;
}

function numericOrderId(gidOrId: string): string {
  const raw = String(gidOrId || "");
  if (raw.startsWith("gid://")) return raw.split("/").pop() || raw;
  return raw;
}

export async function fetchOrderFinancialStatuses(
  shopDomain: string,
  shopifyOrderIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [
    ...new Set(
      shopifyOrderIds.map((id) => String(id || "").trim()).filter(Boolean),
    ),
  ];
  if (unique.length === 0) return result;

  const accessToken = await getOfflineAccessTokenForShop(shopDomain);
  if (!accessToken) return result;

  const query = `#graphql
    query OrderFinancialStatus($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          displayFinancialStatus
        }
      }
    }
  `;

  const chunkSize = 50;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const response = await fetch(
        `https://${shopDomain}/admin/api/2025-07/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({
            query,
            variables: { ids: chunk.map(orderGid) },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) continue;
      const json = (await response.json()) as {
        data?: { nodes?: GraphqlOrderNode[] };
      };
      for (const node of json.data?.nodes ?? []) {
        if (!node?.id) continue;
        const status = normalizeFinancialStatus(node.displayFinancialStatus);
        if (!status) continue;
        result.set(numericOrderId(node.id), status);
        result.set(node.id, status);
      }
    } catch (error) {
      console.warn("[orders] financial status lookup failed:", error);
    }
  }

  return result;
}

type InvoiceFinancialFields = {
  id: string;
  shopifyOrderId?: string | number | null;
  financialStatus?: string | null;
};

/** Fill missing financialStatus from Shopify and persist (CSV export parity). */
export async function hydrateInvoiceFinancialStatus<
  T extends InvoiceFinancialFields,
>(shopDomain: string, invoices: T[]): Promise<T[]> {
  const missing = invoices.filter(
    (invoice) =>
      !normalizeFinancialStatus(invoice.financialStatus) &&
      invoice.shopifyOrderId,
  );
  if (missing.length === 0) return invoices;

  const statuses = await fetchOrderFinancialStatuses(
    shopDomain,
    missing.map((invoice) => String(invoice.shopifyOrderId)),
  );
  if (statuses.size === 0) return invoices;

  const writes: Array<{ id: string; status: string }> = [];
  for (const invoice of invoices) {
    if (
      normalizeFinancialStatus(invoice.financialStatus) ||
      !invoice.shopifyOrderId
    ) {
      continue;
    }
    const orderId = String(invoice.shopifyOrderId);
    const status =
      statuses.get(orderId) || statuses.get(numericOrderId(orderId));
    if (!status) continue;
    invoice.financialStatus = status;
    writes.push({ id: invoice.id, status });
  }

  if (writes.length > 0) {
    await prisma.$transaction(
      writes.map((write) =>
        prisma.invoice.update({
          where: { id: write.id },
          data: { financialStatus: write.status },
        }),
      ),
    );
  }

  return invoices;
}
