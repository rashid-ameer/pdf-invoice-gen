import type { ShopifyOrder } from "./invoice-create.server";
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

export function numericIdFromGid(
  gidOrId: string | number | null | undefined,
): string {
  const raw = String(gidOrId ?? "").trim();
  if (!raw) return "";
  if (raw.includes("/")) return raw.split("/").pop() || raw;
  return raw;
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
