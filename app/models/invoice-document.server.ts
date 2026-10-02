import type { Invoice } from "@prisma/client";
import prisma from "../db.server";
import { APP_LOCALE, DEFAULT_CURRENCY } from "../constants/app";
import type { Address, DocumentType, InvoiceLineItem, InvoiceTotals, SellerInfo, BuyerInfo } from "../types/index";
import { formatAmount, formatDiscountPercent } from "../utils/money-format";
import { mapWithConcurrency } from "../utils/concurrency";
import { getBrandingForShop } from "./branding.server";
import { mergeConfigWithBranding } from "./template-config.defaults";
import type { BaseLayoutCode } from "./template-config.types";
import {
  resolveTemplateForShop,
  ensureSystemTemplates,
  getActiveStoreForShop,
} from "./template.server";
import {
  mergeDocumentHtml,
  renderTemplateFromConfig,
  type TemplateRenderInvoiceData,
} from "./template-render.server";
import { prepareLineItemsForRender } from "./line-item-render.server";
import { applyA4DocumentLayout } from "./document-preview.server";
import { cachedHtmlToPdfBuffer } from "./pdf-cache.server";

const BULK_RENDER_CONCURRENCY = 4;
/** Safety cap for bulk PDF (packing slips used 50 in the old app). */
export const BULK_INVOICE_LIMIT = 50;

function formatIssueDate(date: Date): string {
  return date.toLocaleDateString(APP_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAddressLine(
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    emirate?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null,
): string | undefined {
  if (!address) return undefined;
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.emirate,
    address.postalCode,
    address.country,
  ].filter((part): part is string => Boolean(part && String(part).trim()));
  return parts.length ? parts.join(", ") : undefined;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return value as T;
}

function asDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function invoiceToRenderData(
  invoice: Invoice,
  documentType: DocumentType = "tax_invoice",
): TemplateRenderInvoiceData {
  const seller = parseJson<Partial<SellerInfo>>(invoice.seller, {});
  const buyer = parseJson<Partial<BuyerInfo>>(invoice.buyer, {});
  const shippingAddress = parseJson<Address | null>(
    invoice.shippingAddress,
    null,
  );
  const lineItems = parseJson<InvoiceLineItem[]>(invoice.lineItems, []);
  const totals = parseJson<InvoiceTotals>(invoice.totals, {
    subtotal: 0,
    discount: 0,
    vatTotal: 0,
    shipping: 0,
    grandTotal: 0,
  });
  const pint = parseJson<{ dueDate?: string | Date | null } | null>(
    invoice.pint,
    null,
  );

  const shipToAddress =
    documentType === "packing_slip"
      ? formatAddressLine(shippingAddress) ||
        formatAddressLine(buyer.address)
      : formatAddressLine(buyer.address) ||
        formatAddressLine(shippingAddress);

  const dueDate = asDate(pint?.dueDate);

  return {
    invoiceNumber: invoice.invoiceNumber,
    orderNumber: invoice.shopifyOrderNumber ?? undefined,
    issueDate: formatIssueDate(invoice.issueDate ?? new Date()),
    dueDate: dueDate ? formatIssueDate(dueDate) : undefined,
    currency: invoice.currency ?? DEFAULT_CURRENCY,
    shippingMethod: invoice.shippingMethod ?? undefined,
    orderNote: invoice.orderNote ?? undefined,
    seller: {
      legalName: seller.legalName ?? "Seller",
      tradeName: seller.tradeName ?? undefined,
      trn: seller.trn ?? "—",
      tin: seller.tin ?? undefined,
      tradeLicence: seller.tradeLicence ?? "",
      businessEmail: seller.businessEmail ?? undefined,
      businessPhone: seller.businessPhone ?? undefined,
      address: {
        line1: seller.address?.line1 ?? "",
        city: seller.address?.city ?? "",
        emirate: seller.address?.emirate ?? seller.emirate ?? "",
        country: seller.address?.country ?? "",
      },
    },
    buyer: {
      name: buyer.name ?? "Customer",
      legalName: buyer.legalName ?? undefined,
      trn: buyer.trn ?? undefined,
      tin: buyer.tin ?? undefined,
      email: buyer.email ?? "",
      phone: buyer.phone ?? undefined,
      addressLine: shipToAddress,
    },
    lineItems: lineItems.map((item) => ({
      description: item.description,
      productTitle: item.productTitle ?? undefined,
      variantTitle: item.variantTitle ?? undefined,
      imageUrl: item.imageUrl ?? undefined,
      barcode: item.barcode ?? undefined,
      quantity: item.quantity,
      unitPrice: formatAmount(item.unitPrice),
      discount: formatDiscountPercent(
        item.discount ?? 0,
        item.quantity,
        item.unitPrice,
      ),
      vatRate: `${item.vatRate ?? 0}%`,
      vatAmount: formatAmount(item.vatAmount),
      lineTotal: formatAmount(item.lineTotal),
      sku: item.sku ?? undefined,
    })),
    totals: {
      subtotal: formatAmount(totals.subtotal),
      discount: formatAmount(totals.discount ?? 0),
      vatTotal: formatAmount(totals.vatTotal),
      shipping: formatAmount(totals.shipping ?? 0),
      grandTotal: formatAmount(totals.grandTotal),
      totalWithoutTax:
        totals.totalWithoutTax != null
          ? formatAmount(totals.totalWithoutTax)
          : undefined,
      amountDue:
        totals.amountDue != null ? formatAmount(totals.amountDue) : undefined,
    },
  };
}

export type RenderedInvoiceDocument = {
  html: string;
  invoiceNumber: string;
  orderNumber: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  documentType: DocumentType;
};

/**
 * Shared render path for an existing invoice document (tax invoice or packing slip).
 * Template resolved at view/download time. QR/verification only for tax invoices (Group 13).
 */
async function renderDocumentForInvoice(
  shopDomain: string,
  invoiceId: string,
  templateId: string | undefined,
  documentType: DocumentType,
): Promise<RenderedInvoiceDocument | null> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, storeId: store.id },
  });
  if (!invoice) return null;

  const resolved = await resolveTemplateForShop(
    shopDomain,
    templateId,
    documentType,
  );
  if (!resolved) return null;

  const layout = (resolved.template.baseLayoutCode ?? "modern") as BaseLayoutCode;
  const data = invoiceToRenderData(invoice, documentType);
  const branding = await getBrandingForShop(shopDomain);
  const config = mergeConfigWithBranding(
    resolved.config,
    branding,
    documentType,
  );

  // Group 13: QR / integrity verification — do not attach here.
  data.lineItems = await prepareLineItemsForRender(data.lineItems, config);

  const customHtml =
    typeof resolved.template.customHtml === "string"
      ? resolved.template.customHtml
      : null;
  const customCss =
    typeof resolved.template.customCss === "string"
      ? resolved.template.customCss
      : null;

  const html = renderTemplateFromConfig(
    layout,
    config,
    data,
    documentType,
    customHtml,
    undefined,
    resolved.template.sourceType,
    customCss,
    { pintStrict: invoice.mode === "compliance" },
  );

  return {
    html,
    invoiceNumber: invoice.invoiceNumber,
    orderNumber: invoice.shopifyOrderNumber ?? invoice.invoiceNumber,
    templateId: resolved.template.id,
    templateCode: resolved.template.code,
    templateName: resolved.template.name,
    documentType,
  };
}

/** Render tax invoice HTML for an existing invoice. */
export async function renderInvoiceDocument(
  shopDomain: string,
  invoiceId: string,
  templateId?: string,
): Promise<RenderedInvoiceDocument | null> {
  return renderDocumentForInvoice(
    shopDomain,
    invoiceId,
    templateId,
    "tax_invoice",
  );
}

export async function renderInvoiceDocumentPdf(
  shopDomain: string,
  invoiceId: string,
  templateId?: string,
): Promise<{ pdf: Buffer; doc: RenderedInvoiceDocument } | null> {
  const doc = await renderInvoiceDocument(shopDomain, invoiceId, templateId);
  if (!doc) return null;
  const a4 = applyA4DocumentLayout(doc.html);
  const pdf = await cachedHtmlToPdfBuffer(a4);
  return { pdf, doc };
}

/** Render packing slip HTML (default packing_slip template when templateId omitted). */
export async function renderPackingSlipDocument(
  shopDomain: string,
  invoiceId: string,
  templateId?: string,
): Promise<RenderedInvoiceDocument | null> {
  return renderDocumentForInvoice(
    shopDomain,
    invoiceId,
    templateId,
    "packing_slip",
  );
}

export async function renderPackingSlipDocumentPdf(
  shopDomain: string,
  invoiceId: string,
  templateId?: string,
): Promise<{ pdf: Buffer; doc: RenderedInvoiceDocument } | null> {
  const doc = await renderPackingSlipDocument(shopDomain, invoiceId, templateId);
  if (!doc) return null;
  const a4 = applyA4DocumentLayout(doc.html);
  const pdf = await cachedHtmlToPdfBuffer(a4);
  return { pdf, doc };
}

export async function renderInvoicesBulk(
  shopDomain: string,
  invoiceIds: string[],
  templateId?: string,
): Promise<{
  html: string;
  count: number;
  invoiceNumbers: string[];
  templateId: string;
  templateName: string;
  templateCode: string;
} | null> {
  const uniqueIds = [
    ...new Set(invoiceIds.map((id) => String(id).trim()).filter(Boolean)),
  ].slice(0, BULK_INVOICE_LIMIT);
  if (uniqueIds.length === 0) return null;

  const rendered = await mapWithConcurrency(
    uniqueIds,
    BULK_RENDER_CONCURRENCY,
    (id) => renderInvoiceDocument(shopDomain, id, templateId),
  );

  const docs: Array<{ html: string; invoiceNumber: string }> = [];
  let templateMeta: {
    templateId: string;
    templateName: string;
    templateCode: string;
  } | null = null;

  for (const doc of rendered) {
    if (!doc) continue;
    docs.push({ html: doc.html, invoiceNumber: doc.invoiceNumber });
    templateMeta = {
      templateId: doc.templateId,
      templateName: doc.templateName,
      templateCode: doc.templateCode,
    };
  }

  if (!docs.length || !templateMeta) return null;

  return {
    html: mergeDocumentHtml(
      docs.map((d) => d.html),
      "Invoices",
    ),
    count: docs.length,
    invoiceNumbers: docs.map((d) => d.invoiceNumber),
    ...templateMeta,
  };
}

export async function renderInvoicesBulkPdf(
  shopDomain: string,
  invoiceIds: string[],
  templateId?: string,
): Promise<{
  pdf: Buffer;
  count: number;
  templateId: string;
  templateName: string;
} | null> {
  const bulk = await renderInvoicesBulk(shopDomain, invoiceIds, templateId);
  if (!bulk) return null;
  const a4 = applyA4DocumentLayout(bulk.html);
  const pdf = await cachedHtmlToPdfBuffer(a4);
  return {
    pdf,
    count: bulk.count,
    templateId: bulk.templateId,
    templateName: bulk.templateName,
  };
}

/** Old recordInvoiceDownload: generated → downloaded + status event. */
export async function recordInvoiceDownload(
  shopDomain: string,
  invoiceId: string,
  templateId: string,
  templateName: string,
): Promise<void> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, storeId: store.id },
  });
  if (!invoice) return;

  if (invoice.status === "generated") {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "downloaded" },
    });
  }

  await prisma.invoiceStatusEvent.create({
    data: {
      invoiceId: invoice.id,
      status: "downloaded",
      source: "merchant",
      message: `Invoice downloaded using ${templateName} template`,
      metadata: {
        templateId,
        templateName,
        documentType: "tax_invoice",
      },
    },
  });
}

/**
 * Old recordPackingSlipDownload: status event only.
 * Does NOT flip invoice.status to downloaded.
 */
export async function recordPackingSlipDownload(
  shopDomain: string,
  invoiceId: string,
  templateId: string,
  templateName: string,
): Promise<void> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, storeId: store.id },
  });
  if (!invoice) return;

  await prisma.invoiceStatusEvent.create({
    data: {
      invoiceId: invoice.id,
      status: "packing_slip_downloaded",
      source: "merchant",
      message: `Packing slip downloaded using ${templateName} template`,
      metadata: {
        templateId,
        templateName,
        documentType: "packing_slip",
      },
    },
  });
}

export type InvoiceTemplateOption = {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
};

/** Tax-invoice templates available for the shop (system + store customs). */
export async function listTaxInvoiceTemplatesForShop(
  shopDomain: string,
): Promise<InvoiceTemplateOption[] | null> {
  await ensureSystemTemplates();
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const templates = await prisma.invoiceTemplate.findMany({
    where: {
      isActive: true,
      documentType: "tax_invoice",
      OR: [{ isSystem: true }, { storeId: store.id }],
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    isDefault: store.defaultTemplateId === t.id,
  }));
}

export type InvoiceDetailsData = {
  id: string;
  invoiceNumber: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  buyerName: string;
  issueDateIso: string;
  status: string;
  financialStatus: string | null;
  currency: string;
  grandTotal: number;
  shopDomain: string;
  /** Shopify Admin order URL when a numeric order id is available. */
  orderAdminUrl: string | null;
  /** Same-origin embed URL for the G5/G7 rendered invoice HTML. */
  previewEmbedUrl: string;
  printUrl: string;
  downloadUrl: string;
};

function shopifyAdminOrderUrl(
  shopDomain: string,
  shopifyOrderId: string,
): string | null {
  const orderId = String(shopifyOrderId || "").trim();
  if (!/^\d+$/.test(orderId)) return null;
  const handle = shopDomain
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .replace(/\.myshopify\.com$/i, "");
  if (!handle) return null;
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/orders/${orderId}`;
}

/**
 * Load invoice metadata for the Polaris details page.
 * Document HTML/PDF continue to come from renderInvoiceDocument* (G5/G7).
 */
export async function getInvoiceDetailsForShop(
  shopDomain: string,
  invoiceId: string,
): Promise<InvoiceDetailsData | null> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, storeId: store.id },
  });
  if (!invoice) return null;

  const buyer = parseJson<{ name?: string | null }>(invoice.buyer, {});
  const totals = parseJson<{ grandTotal?: number }>(invoice.totals, {});
  const encodedId = encodeURIComponent(invoice.id);

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    shopifyOrderId: invoice.shopifyOrderId,
    shopifyOrderNumber: invoice.shopifyOrderNumber ?? "—",
    buyerName: buyer.name?.trim() || "Customer",
    issueDateIso: invoice.issueDate.toISOString(),
    status: invoice.status,
    financialStatus: invoice.financialStatus,
    currency: invoice.currency || DEFAULT_CURRENCY,
    grandTotal: totals.grandTotal ?? 0,
    shopDomain: store.shopifyDomain,
    orderAdminUrl: shopifyAdminOrderUrl(
      store.shopifyDomain,
      invoice.shopifyOrderId,
    ),
    previewEmbedUrl: `/app/invoices/${encodedId}/view?embed=1`,
    printUrl: `/app/invoices/${encodedId}/download?mode=print`,
    downloadUrl: `/app/invoices/${encodedId}/download`,
  };
}
