import type { ShopifyOrder } from "./invoice-create.server";
import type { ShopifyRefund } from "./credit-note.server";
import { getOfflineAccessTokenForShop } from "./shopify-offline-session.server";

type MoneySet = {
  shopMoney?: { amount?: string | null; currencyCode?: string | null } | null;
} | null;

type GqlAddress = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
};

type GqlLineItem = {
  id?: string | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variantTitle?: string | null;
  quantity?: number | null;
  variant?: { id?: string | null } | null;
  product?: { id?: string | null } | null;
  originalUnitPriceSet?: MoneySet;
  totalDiscountSet?: MoneySet;
  discountAllocations?: Array<{ allocatedAmountSet?: MoneySet } | null> | null;
  taxLines?: Array<{ rate?: number | null; priceSet?: MoneySet } | null> | null;
};

type GqlRefund = {
  id?: string | null;
  createdAt?: string | null;
  note?: string | null;
  refundLineItems?: {
    nodes?: Array<{
      quantity?: number | null;
      restockType?: string | null;
      subtotalSet?: MoneySet;
      totalTaxSet?: MoneySet;
      lineItem?: GqlLineItem | null;
    } | null> | null;
  } | null;
  transactions?: {
    nodes?: Array<{
      amountSet?: MoneySet;
      status?: string | null;
    } | null> | null;
  } | null;
  orderAdjustments?: {
    nodes?: Array<{
      amountSet?: MoneySet;
      taxAmountSet?: MoneySet;
      reason?: string | null;
    } | null> | null;
  } | null;
};

export type GraphqlOrder = {
  id?: string | null;
  legacyResourceId?: string | null;
  name?: string | null;
  email?: string | null;
  note?: string | null;
  createdAt?: string | null;
  currencyCode?: string | null;
  displayFinancialStatus?: string | null;
  customAttributes?: Array<{
    key?: string | null;
    value?: string | null;
  } | null> | null;
  currentTotalPriceSet?: MoneySet;
  currentSubtotalPriceSet?: MoneySet;
  currentTotalTaxSet?: MoneySet;
  currentTotalDiscountsSet?: MoneySet;
  totalShippingPriceSet?: MoneySet;
  customer?: {
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    defaultEmailAddress?: { emailAddress?: string | null } | null;
    defaultPhoneNumber?: { phoneNumber?: string | null } | null;
  } | null;
  billingAddress?: GqlAddress | null;
  shippingAddress?: GqlAddress | null;
  shippingLines?: {
    nodes?: Array<{ title?: string | null; code?: string | null } | null> | null;
  } | null;
  lineItems?: { nodes?: Array<GqlLineItem | null> | null } | null;
  refunds?: Array<GqlRefund | null> | null;
};

const ORDER_INVOICE_FIELDS = `
  id
  legacyResourceId
  name
  email
  note
  createdAt
  currencyCode
  displayFinancialStatus
  customAttributes { key value }
  currentTotalPriceSet { shopMoney { amount } }
  currentSubtotalPriceSet { shopMoney { amount } }
  currentTotalTaxSet { shopMoney { amount } }
  currentTotalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  customer {
    id
    firstName
    lastName
    defaultEmailAddress { emailAddress }
    defaultPhoneNumber { phoneNumber }
  }
  billingAddress { name firstName lastName company phone address1 address2 city province zip country countryCodeV2 }
  shippingAddress { name firstName lastName company phone address1 address2 city province zip country countryCodeV2 }
  shippingLines(first: 5) { nodes { title code } }
  lineItems(first: 100) {
    nodes {
      id
      sku
      title
      name
      variantTitle
      quantity
      variant { id }
      product { id }
      originalUnitPriceSet { shopMoney { amount } }
      totalDiscountSet { shopMoney { amount } }
      discountAllocations { allocatedAmountSet { shopMoney { amount } } }
      taxLines { rate priceSet { shopMoney { amount } } }
    }
  }
`;

const ORDERS_SYNC_QUERY = `#graphql
  query OrdersSync($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true, query: "status:any") {
      nodes {
        ${ORDER_INVOICE_FIELDS}
      }
    }
  }
`;

const ORDER_BY_ID_QUERY = `#graphql
  query OrderById($id: ID!) {
    order(id: $id) {
      ${ORDER_INVOICE_FIELDS}
      refunds {
        id
        createdAt
        note
        refundLineItems(first: 100) {
          nodes {
            quantity
            restockType
            subtotalSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
            lineItem {
              id
              title
              name
              sku
              quantity
              variantTitle
              originalUnitPriceSet { shopMoney { amount } }
              taxLines { rate priceSet { shopMoney { amount } } }
            }
          }
        }
        transactions(first: 20) {
          nodes {
            amountSet { shopMoney { amount currencyCode } }
            status
          }
        }
        orderAdjustments(first: 20) {
          nodes {
            amountSet { shopMoney { amount } }
            taxAmountSet { shopMoney { amount } }
            reason
          }
        }
      }
    }
  }
`;

const ORDER_BY_ID_WITH_REFUNDS_QUERY = `#graphql
  query OrderByIdWithRefunds($id: ID!) {
    order(id: $id) {
      id
      legacyResourceId
      refunds {
        id
        createdAt
        note
        refundLineItems(first: 100) {
          nodes {
            quantity
            restockType
            subtotalSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
            lineItem {
              id
              title
              name
              sku
              quantity
              variantTitle
              originalUnitPriceSet { shopMoney { amount } }
              taxLines { rate priceSet { shopMoney { amount } } }
            }
          }
        }
        transactions(first: 20) {
          nodes {
            amountSet { shopMoney { amount currencyCode } }
            status
          }
        }
        orderAdjustments(first: 20) {
          nodes {
            amountSet { shopMoney { amount } }
            taxAmountSet { shopMoney { amount } }
            reason
          }
        }
      }
    }
  }
`;

export function numericIdFromGid(
  gidOrId: string | number | null | undefined,
): string {
  const raw = String(gidOrId ?? "").trim();
  if (!raw) return "";
  if (raw.includes("/")) return raw.split("/").pop() || raw;
  return raw;
}

export function orderGid(id: string | number): string {
  const raw = String(id || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/Order/${raw}`;
}

function moneyAmount(set?: MoneySet): string {
  return set?.shopMoney?.amount || "0";
}

function mapAddress(
  addr?: GqlAddress | null,
): ShopifyOrder["billing_address"] {
  if (!addr) return undefined;
  return {
    name: addr.name ?? undefined,
    first_name: addr.firstName ?? undefined,
    last_name: addr.lastName ?? undefined,
    company: addr.company ?? undefined,
    phone: addr.phone ?? undefined,
    address1: addr.address1 ?? undefined,
    address2: addr.address2 ?? undefined,
    city: addr.city ?? undefined,
    province: addr.province ?? undefined,
    zip: addr.zip ?? undefined,
    country: addr.country ?? undefined,
    country_code: addr.countryCodeV2 ?? undefined,
  };
}

function mapLineItem(item: GqlLineItem): ShopifyOrder["line_items"][number] {
  const allocations = (item.discountAllocations ?? [])
    .map((allocation) => ({
      amount: moneyAmount(allocation?.allocatedAmountSet),
    }))
    .filter((allocation) => parseFloat(allocation.amount) > 0);

  return {
    sku: item.sku ?? undefined,
    title: item.title || item.name || "Item",
    variant_title: item.variantTitle ?? null,
    variant_id: item.variant?.id
      ? Number(numericIdFromGid(item.variant.id)) || null
      : null,
    product_id: item.product?.id
      ? Number(numericIdFromGid(item.product.id)) || null
      : null,
    quantity: item.quantity ?? 0,
    price: moneyAmount(item.originalUnitPriceSet),
    total_discount: moneyAmount(item.totalDiscountSet),
    discount_allocations: allocations,
    tax_lines: (item.taxLines ?? []).map((tax) => ({
      rate: tax?.rate ?? 0,
      price: moneyAmount(tax?.priceSet),
    })),
  };
}

export function mapGraphqlOrderToShopifyOrder(order: GraphqlOrder): ShopifyOrder {
  const id = Number(numericIdFromGid(order.legacyResourceId || order.id));
  const customerId = order.customer?.id
    ? Number(numericIdFromGid(order.customer.id))
    : 0;
  const email =
    order.customer?.defaultEmailAddress?.emailAddress || order.email || "";

  return {
    id,
    order_number: id,
    name: order.name || `#${id}`,
    email,
    note: order.note ?? null,
    note_attributes: (order.customAttributes ?? [])
      .filter(
        (attr): attr is { key?: string | null; value?: string | null } =>
          Boolean(attr?.key),
      )
      .map((attr) => ({
        name: attr.key ?? undefined,
        value: attr.value ?? undefined,
      })),
    currency: order.currencyCode || "USD",
    financial_status: order.displayFinancialStatus
      ? order.displayFinancialStatus.toLowerCase()
      : undefined,
    total_price: moneyAmount(order.currentTotalPriceSet),
    subtotal_price: moneyAmount(order.currentSubtotalPriceSet),
    total_tax: moneyAmount(order.currentTotalTaxSet),
    total_discounts: moneyAmount(order.currentTotalDiscountsSet),
    total_shipping_price_set: {
      shop_money: { amount: moneyAmount(order.totalShippingPriceSet) },
    },
    created_at: order.createdAt || new Date().toISOString(),
    customer: order.customer
      ? {
          id: customerId,
          first_name: order.customer.firstName ?? undefined,
          last_name: order.customer.lastName ?? undefined,
          email: email || undefined,
          phone: order.customer.defaultPhoneNumber?.phoneNumber ?? undefined,
        }
      : undefined,
    billing_address: mapAddress(order.billingAddress),
    shipping_address: mapAddress(order.shippingAddress),
    shipping_lines: (order.shippingLines?.nodes ?? [])
      .filter(
        (line): line is { title?: string | null; code?: string | null } =>
          Boolean(line),
      )
      .map((line) => ({
        title: line.title ?? undefined,
        code: line.code ?? undefined,
      })),
    line_items: (order.lineItems?.nodes ?? [])
      .filter((item): item is GqlLineItem => Boolean(item))
      .map(mapLineItem),
  };
}

/** Map GraphQL order.refunds → Phase 1 ShopifyRefund shape (old mapGraphqlRefunds). */
export function mapGraphqlRefunds(order: GraphqlOrder): ShopifyRefund[] {
  const orderId = Number(numericIdFromGid(order.legacyResourceId || order.id));
  return (order.refunds ?? [])
    .filter((refund): refund is GqlRefund => Boolean(refund?.id))
    .map((refund) => {
      const restock = (refund.refundLineItems?.nodes ?? []).some(
        (item) => item?.restockType && item.restockType !== "NO_RESTOCK",
      );
      return {
        id: Number(numericIdFromGid(refund.id)),
        order_id: orderId,
        created_at: refund.createdAt ?? undefined,
        note: refund.note ?? null,
        restock,
        refund_line_items: (refund.refundLineItems?.nodes ?? [])
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((item) => ({
            quantity: item.quantity ?? 1,
            subtotal: moneyAmount(item.subtotalSet),
            total_tax: moneyAmount(item.totalTaxSet),
            line_item_id: item.lineItem?.id
              ? Number(numericIdFromGid(item.lineItem.id))
              : undefined,
            line_item: item.lineItem
              ? {
                  id: Number(numericIdFromGid(item.lineItem.id)),
                  title: item.lineItem.title ?? undefined,
                  name: item.lineItem.name ?? undefined,
                  sku: item.lineItem.sku ?? null,
                  quantity: item.lineItem.quantity ?? undefined,
                  price: moneyAmount(item.lineItem.originalUnitPriceSet),
                  variant_title: item.lineItem.variantTitle ?? null,
                  tax_lines: (item.lineItem.taxLines ?? []).map((tax) => ({
                    rate: tax?.rate ?? undefined,
                    price: moneyAmount(tax?.priceSet),
                  })),
                }
              : undefined,
          })),
        transactions: (refund.transactions?.nodes ?? [])
          .filter((tx): tx is NonNullable<typeof tx> => Boolean(tx))
          .map((tx) => ({
            amount: moneyAmount(tx.amountSet),
            currency: tx.amountSet?.shopMoney?.currencyCode ?? undefined,
            status: tx.status ? String(tx.status).toLowerCase() : undefined,
          })),
        order_adjustments: (refund.orderAdjustments?.nodes ?? [])
          .filter((adj): adj is NonNullable<typeof adj> => Boolean(adj))
          .map((adj) => ({
            amount: moneyAmount(adj.amountSet),
            tax_amount: moneyAmount(adj.taxAmountSet),
            reason: adj.reason ?? undefined,
          })),
      };
    });
}

async function graphqlRequest<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${shopDomain}/admin/api/2025-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!response.ok) {
    const err = new Error(`Shopify GraphQL HTTP ${response.status}`) as Error & {
      statusCode?: number;
    };
    err.statusCode = response.status;
    throw err;
  }
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e) => e.message || "GraphQL error").join("; "),
    );
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data");
  return json.data;
}

export async function fetchRecentOrders(
  shopDomain: string,
  first = 50,
): Promise<ShopifyOrder[]> {
  const limit = Math.min(Math.max(first, 1), 50);
  const accessToken = await getOfflineAccessTokenForShop(shopDomain);
  if (!accessToken) {
    throw new Error("Shopify session missing. Re-authorize the app from Shopify Admin.");
  }

  const data = await graphqlRequest<{
    orders?: { nodes?: Array<GraphqlOrder | null> };
  }>(shopDomain, accessToken, ORDERS_SYNC_QUERY, { first: limit });

  return (data.orders?.nodes ?? [])
    .filter((order): order is GraphqlOrder => Boolean(order?.id))
    .map(mapGraphqlOrderToShopifyOrder);
}

/**
 * Fetch one Shopify order by GID/numeric ID (old fetchOrderById).
 * Used by Group 15 ensure-invoice when no local invoice exists.
 */
export async function fetchOrderById(
  shopDomain: string,
  shopifyOrderId: string,
): Promise<{ order: ShopifyOrder; refunds: ShopifyRefund[] } | null> {
  const accessToken = await getOfflineAccessTokenForShop(shopDomain);
  if (!accessToken) {
    throw new Error(
      "Shopify session missing. Re-authorize the app from Shopify Admin.",
    );
  }

  const data = await graphqlRequest<{ order?: GraphqlOrder | null }>(
    shopDomain,
    accessToken,
    ORDER_BY_ID_QUERY,
    { id: orderGid(shopifyOrderId) },
  );
  if (!data.order?.id) return null;
  return {
    order: mapGraphqlOrderToShopifyOrder(data.order),
    refunds: mapGraphqlRefunds(data.order),
  };
}

/**
 * Fetch refunds for one order via Admin GraphQL (old fetchOrderRefunds).
 * Returns Phase 1–compatible ShopifyRefund[] — no invoice create.
 */
export async function fetchOrderRefunds(
  shopDomain: string,
  shopifyOrderId: string,
): Promise<ShopifyRefund[]> {
  const accessToken = await getOfflineAccessTokenForShop(shopDomain);
  if (!accessToken) {
    throw new Error(
      "Shopify session missing. Re-authorize the app from Shopify Admin.",
    );
  }

  const data = await graphqlRequest<{ order?: GraphqlOrder | null }>(
    shopDomain,
    accessToken,
    ORDER_BY_ID_WITH_REFUNDS_QUERY,
    { id: orderGid(shopifyOrderId) },
  );
  if (!data.order?.id) return [];
  return mapGraphqlRefunds(data.order);
}
