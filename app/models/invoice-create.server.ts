import { Prisma, type Invoice } from "@prisma/client";
import type { Address, InvoiceLineItem, InvoiceTotals } from "../types/index";
import prisma from "../db.server";
import { nextInvoiceNumber } from "./document-number.server";
import {
  allocateOrderDiscountToLines,
  alignVatRatesToAmounts,
  grossSubtotalForLines,
  normalizeInvoiceDiscounts,
  type DiscountableLine,
} from "./tax.server";
import {
  buildPintMetadata,
  enrichLineItemsForPint,
  parseBuyerIdentifiersFromOrder,
} from "./pint.server";
import {
  buildFallbackSellerSnapshot,
  buildSellerSnapshot,
} from "./seller-snapshot.server";
import { enrichLineItemsFromShopifyOrder } from "./shopify-variant-enrichment.server";
import { normalizeFinancialStatus } from "../utils/csv";
import { invalidateDashboardCacheForShop } from "./dashboard-cache.server";
import {
  scheduleInvoiceAutoEmail,
  scheduleInvoiceAutoEmailOnPaid,
} from "./document-email.server";

type EnrichFn = typeof enrichLineItemsFromShopifyOrder;

/** Test seam — restore with restoreEnrichLineItemsForTests(). */
let enrichLineItemsImpl: EnrichFn = enrichLineItemsFromShopifyOrder;

export function setEnrichLineItemsForTests(fn: EnrichFn): void {
  enrichLineItemsImpl = fn;
}

export function restoreEnrichLineItemsForTests(): void {
  enrichLineItemsImpl = enrichLineItemsFromShopifyOrder;
}

export interface ShopifyAddress {
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
  country_code?: string;
}

export interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  email: string;
  note?: string | null;
  note_attributes?: Array<{ name?: string; value?: string }>;
  currency: string;
  financial_status?: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  total_shipping_price_set?: { shop_money?: { amount: string } };
  created_at: string;
  customer?: {
    id: number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  billing_address?: ShopifyAddress;
  shipping_address?: ShopifyAddress;
  shipping_lines?: Array<{ title?: string; code?: string }>;
  line_items: Array<{
    sku?: string;
    title: string;
    variant_title?: string | null;
    variant_id?: number | null;
    product_id?: number | null;
    quantity: number;
    price: string;
    total_discount: string;
    discount_allocations?: Array<{ amount: string }>;
    tax_lines: Array<{ rate: number; price: string }>;
  }>;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function lineDiscountFromShopify(
  item: ShopifyOrder["line_items"][number],
): number {
  let discount = parseFloat(item.total_discount || "0");
  if (discount <= 0 && item.discount_allocations?.length) {
    discount = item.discount_allocations.reduce(
      (sum, allocation) => sum + parseFloat(allocation.amount || "0"),
      0,
    );
  }
  return roundMoney(discount);
}

export function buildLineItemsFromShopifyOrder(
  order: ShopifyOrder,
): DiscountableLine[] {
  const raw = (order.line_items ?? []).map((item) => {
    const taxLines = item.tax_lines ?? [];
    const vatAmount = taxLines.reduce(
      (sum, t) => sum + parseFloat(t.price || "0"),
      0,
    );
    const discount = lineDiscountFromShopify(item);
    const net = item.quantity * parseFloat(item.price || "0") - discount;
    const vatRate =
      taxLines.length > 0 && taxLines[0].rate != null
        ? taxLines[0].rate * 100
        : vatAmount > 0 && net > 0
          ? (vatAmount / net) * 100
          : 0;
    const description = item.variant_title
      ? `${item.title} ? ${item.variant_title}`
      : item.title;
    return {
      sku: item.sku || undefined,
      description,
      productTitle: item.title,
      variantTitle: item.variant_title?.trim() || undefined,
      quantity: item.quantity,
      unitPrice: parseFloat(item.price || "0"),
      discount,
      vatRate,
      vatAmount,
      lineTotal: roundMoney(net + vatAmount),
    };
  });

  const orderDiscount = parseFloat(order.total_discounts || "0");
  return allocateOrderDiscountToLines(raw, orderDiscount);
}

function mapShopifyAddress(addr?: ShopifyAddress): Address | undefined {
  if (!addr?.address1 && !addr?.city) return undefined;
  return {
    line1: addr.address1 || "",
    line2: addr.address2 || undefined,
    city: addr.city || "",
    emirate: addr.province || undefined,
    postalCode: addr.zip || undefined,
    country: addr.country_code || addr.country || "",
  };
}

function addressDisplayName(addr?: ShopifyAddress, fallback = "Customer"): string {
  if (addr?.name?.trim()) return addr.name.trim();
  const parts = [addr?.first_name, addr?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (parts) return parts;
  if (addr?.company?.trim()) return addr.company.trim();
  return fallback;
}

function orderIsPaidFlag(
  order: ShopifyOrder,
  options?: { orderIsPaid?: boolean },
): boolean {
  return (
    options?.orderIsPaid === true ||
    order.financial_status === "paid" ||
    order.financial_status === "partially_paid"
  );
}

function parseLineItems(value: unknown): InvoiceLineItem[] {
  return (Array.isArray(value) ? value : []) as InvoiceLineItem[];
}

function parseTotals(value: unknown): InvoiceTotals {
  const t = (value ?? {}) as Partial<InvoiceTotals>;
  return {
    subtotal: t.subtotal ?? 0,
    discount: t.discount ?? 0,
    vatTotal: t.vatTotal ?? 0,
    shipping: t.shipping ?? 0,
    grandTotal: t.grandTotal ?? 0,
    ...(t.totalWithoutTax !== undefined
      ? { totalWithoutTax: t.totalWithoutTax }
      : {}),
    ...(t.amountDue !== undefined ? { amountDue: t.amountDue } : {}),
  };
}

/** Align line discount % and subtotal when Shopify applied coupons at order level only. */
export async function repairInvoiceDiscountAlignment(
  invoiceId: string,
): Promise<Invoice | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;

  const lineItems = parseLineItems(invoice.lineItems);
  if (!lineItems.length) return invoice;

  const normalized = normalizeInvoiceDiscounts({
    lineItems,
    totals: parseTotals(invoice.totals),
  });

  if (!normalized.changed) return invoice;

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      lineItems: toJson(normalized.lineItems),
      totals: toJson(normalized.totals),
    },
  });
}

/** Clear invented VAT % when Shopify recorded no tax (rate label must match amounts). */
export async function repairInvoiceVatAlignedToAmounts(
  invoiceId: string,
): Promise<Invoice | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;

  const lineItems = parseLineItems(invoice.lineItems);
  if (!lineItems.length) return invoice;

  const aligned = alignVatRatesToAmounts({
    lineItems,
    totals: parseTotals(invoice.totals),
  });

  if (!aligned.changed) return invoice;

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      lineItems: toJson(aligned.lineItems),
      ...(aligned.totals ? { totals: toJson(aligned.totals) } : {}),
    },
  });
}

export type CreateInvoiceOptions = {
  orderIsPaid?: boolean;
  /** Test override — skip / replace Shopify variant enrichment. */
  enrichLineItems?: EnrichFn;
};

/** Create invoice from a Shopify order payload. Safe to call from webhooks or manual sync. */
export async function createInvoiceFromShopifyOrder(
  shopDomain: string,
  order: ShopifyOrder,
  source: "webhook" | "sync" = "webhook",
  options?: CreateInvoiceOptions,
): Promise<Invoice | null> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) {
    console.warn(`[orders] store not found for ${shopDomain}`);
    return null;
  }

  const existingInvoice = await prisma.invoice.findUnique({
    where: {
      storeId_shopifyOrderId: {
        storeId: store.id,
        shopifyOrderId: String(order.id),
      },
    },
  });
  if (existingInvoice) {
    await repairInvoiceVatAlignedToAmounts(existingInvoice.id);
    await repairInvoiceDiscountAlignment(existingInvoice.id);
    if (
      order.financial_status &&
      existingInvoice.financialStatus !==
        normalizeFinancialStatus(order.financial_status)
    ) {
      return prisma.invoice.update({
        where: { id: existingInvoice.id },
        data: {
          financialStatus: normalizeFinancialStatus(order.financial_status),
        },
      });
    }
    console.log(`[orders] invoice already exists for order ${order.name}`);
    return prisma.invoice.findUnique({ where: { id: existingInvoice.id } });
  }

  const legalEntity = store.defaultLegalEntityId
    ? await prisma.legalEntity.findUnique({
        where: { id: store.defaultLegalEntityId },
      })
    : await prisma.legalEntity.findFirst({
        where: { merchantId: store.merchantId, deletedAt: null },
        orderBy: { createdAt: "asc" },
      });

  const lineItems = buildLineItemsFromShopifyOrder(order);
  const enrich = options?.enrichLineItems ?? enrichLineItemsImpl;
  const enrichedLineItems = await enrich(
    shopDomain,
    order.line_items ?? [],
    lineItems,
  );

  if (enrichedLineItems.length === 0) {
    throw new Error(`Order ${order.name} has no line items`);
  }

  const shipping = order.total_shipping_price_set?.shop_money?.amount
    ? parseFloat(order.total_shipping_price_set.shop_money.amount)
    : 0;

  const grossSubtotal = grossSubtotalForLines(enrichedLineItems);
  const orderDiscount = parseFloat(order.total_discounts || "0");

  const billingAddress = order.billing_address;
  const shippingAddress =
    mapShopifyAddress(order.shipping_address) ??
    mapShopifyAddress(billingAddress);
  const buyerName = addressDisplayName(
    order.shipping_address || billingAddress,
    [order.customer?.first_name, order.customer?.last_name]
      .filter(Boolean)
      .join(" ") || "Customer",
  );
  const shippingMethod =
    order.shipping_lines?.[0]?.title ||
    order.shipping_lines?.[0]?.code ||
    undefined;
  const buyerPhone =
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    order.customer?.phone ||
    undefined;

  const invoiceNumber = await nextInvoiceNumber(store.id, store.merchantId);
  const issueDate = new Date(order.created_at || Date.now());
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + 30);

  const pintLineItems = enrichLineItemsForPint(enrichedLineItems);
  const seller = legalEntity
    ? buildSellerSnapshot({
        ...legalEntity,
        address: legalEntity.address as Address,
      })
    : buildFallbackSellerSnapshot(shopDomain, store.currency);
  const buyerIds = parseBuyerIdentifiersFromOrder(order);
  const buyerAddress = mapShopifyAddress(billingAddress) ?? shippingAddress;
  const buyer = {
    name: buyerName,
    legalName: buyerIds.legalName,
    trn: buyerIds.trn,
    tin: buyerIds.tin,
    email: order.customer?.email || order.email,
    phone: buyerPhone,
    address: buyerAddress,
  };

  const totals = {
    subtotal: grossSubtotal,
    discount: orderDiscount,
    vatTotal: parseFloat(order.total_tax || "0"),
    shipping,
    grandTotal: parseFloat(order.total_price || "0"),
  };
  const pint = buildPintMetadata({
    issueDate,
    lineItems: pintLineItems,
    totals,
    dueDate,
  });
  const totalsWithPint = {
    ...totals,
    totalWithoutTax: pint.totalWithoutTax,
    amountDue: pint.amountDue,
  };

  // Old parity: legalEntityId falls back to merchantId when no LegalEntity exists.
  const legalEntityId = legalEntity?.id || store.merchantId;

  let invoice: Invoice;
  try {
    invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          merchantId: store.merchantId,
          storeId: store.id,
          legalEntityId,
          shopifyOrderId: String(order.id),
          shopifyOrderNumber: order.name,
          invoiceNumber,
          mode: store.invoiceMode,
          status: "generated",
          financialStatus:
            normalizeFinancialStatus(order.financial_status) || null,
          issueDate,
          currency: order.currency || store.currency,
          seller: toJson(seller),
          buyer: toJson(buyer),
          ...(shippingAddress
            ? { shippingAddress: toJson(shippingAddress) }
            : {}),
          shippingMethod: shippingMethod ?? null,
          orderNote: order.note?.trim() || null,
          lineItems: toJson(pintLineItems),
          totals: toJson(totalsWithPint),
          pint: toJson(pint),
        },
      });

      await tx.invoiceStatusEvent.create({
        data: {
          invoiceId: created.id,
          status: "generated",
          source: source === "sync" ? "merchant" : "shopify",
          message: `Invoice ${invoiceNumber} created from Shopify order ${order.name} (${source})`,
          metadata: toJson({
            shopifyOrderId: order.id,
            shopifyOrderNumber: order.name,
            source,
          }),
        },
      });

      return created;
    });
  } catch (error) {
    // Concurrent webhook/sync: unique (storeId, shopifyOrderId) already taken.
    if (isUniqueConflict(error)) {
      const existing = await prisma.invoice.findUnique({
        where: {
          storeId_shopifyOrderId: {
            storeId: store.id,
            shopifyOrderId: String(order.id),
          },
        },
      });
      if (existing) {
        console.log(
          `[orders] duplicate create race resolved for order ${order.name} → ${existing.invoiceNumber}`,
        );
        if (orderIsPaidFlag(order, options)) {
          await scheduleInvoiceAutoEmailOnPaid(shopDomain, existing.id);
        }
        return existing;
      }
    }
    throw error;
  }

  console.log(
    `[orders] invoice created: ${invoiceNumber} for order ${order.name} via ${source}`,
  );
  void invalidateDashboardCacheForShop(shopDomain);

  const orderIsPaid = orderIsPaidFlag(order, options);
  await scheduleInvoiceAutoEmail(shopDomain, invoice.id, orderIsPaid);

  return invoice;
}

/**
 * Webhook entrypoint. Idempotent via Invoice uniqueness on (storeId, shopifyOrderId).
 * Shared by orders/create and orders/paid (old parity — no separate paid handler).
 */
export async function handleOrderCreated(
  shopDomain: string,
  rawBody: string | ShopifyOrder,
  topic = "orders/create",
  options?: CreateInvoiceOptions,
): Promise<Invoice | null> {
  const order: ShopifyOrder =
    typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  const orderIsPaid =
    topic === "orders/paid" ||
    topic.includes("paid") ||
    order.financial_status === "paid" ||
    order.financial_status === "partially_paid";

  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) {
    console.warn(`[orders] store not found for ${shopDomain}`);
    return null;
  }

  const existingInvoice = await prisma.invoice.findUnique({
    where: {
      storeId_shopifyOrderId: {
        storeId: store.id,
        shopifyOrderId: String(order.id),
      },
    },
  });
  if (existingInvoice) {
    await repairInvoiceVatAlignedToAmounts(existingInvoice.id);
    await repairInvoiceDiscountAlignment(existingInvoice.id);
    let result = existingInvoice;
    if (
      order.financial_status &&
      existingInvoice.financialStatus !==
        normalizeFinancialStatus(order.financial_status)
    ) {
      result = await prisma.invoice.update({
        where: { id: existingInvoice.id },
        data: {
          financialStatus: normalizeFinancialStatus(order.financial_status),
        },
      });
    }
    if (orderIsPaid) {
      await scheduleInvoiceAutoEmailOnPaid(shopDomain, result.id);
    }
    console.log(
      `[orders] duplicate webhook ignored (invoice exists): shopify_order_${order.id}`,
    );
    return result;
  }

  try {
    return await createInvoiceFromShopifyOrder(shopDomain, order, "webhook", {
      orderIsPaid,
      enrichLineItems: options?.enrichLineItems,
    });
  } catch (error) {
    console.error(`[orders] failed to create invoice for ${order.name}:`, error);
    throw error;
  }
}
