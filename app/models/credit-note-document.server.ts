import type { CreditNote, Invoice } from "@prisma/client";
import prisma from "../db.server";
import { APP_LOCALE, DEFAULT_CURRENCY } from "../constants/app";
import type { Address, InvoiceLineItem, InvoiceTotals, SellerInfo, BuyerInfo } from "../types/index";
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
/** Old credit-notes / refund-documents bulk routes reject > 50. */
export const BULK_CREDIT_NOTE_LIMIT = 50;
export const BULK_REFUND_DOCUMENT_LIMIT = BULK_CREDIT_NOTE_LIMIT;

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

/**
 * Old creditNoteToRenderData — maps CreditNote + original invoice number into
 * TemplateRenderInvoiceData for documentType = credit_note.
 */
export function creditNoteToRenderData(
  creditNote: CreditNote,
  originalInvoiceNumber: string,
  orderNumber?: string | null,
): TemplateRenderInvoiceData {
  const seller = parseJson<Partial<SellerInfo>>(creditNote.seller, {});
  const buyer = parseJson<Partial<BuyerInfo>>(creditNote.buyer, {});
  const lineItems = parseJson<InvoiceLineItem[]>(creditNote.lineItems, []);
  const totals = parseJson<InvoiceTotals>(creditNote.totals, {
    subtotal: 0,
    discount: 0,
    vatTotal: 0,
    shipping: 0,
    grandTotal: 0,
  });
  const buyerAddress = parseJson<Address | null>(buyer.address ?? null, null);

  return {
    invoiceNumber: creditNote.creditNoteNumber,
    orderNumber: orderNumber ?? undefined,
    originalInvoiceNumber,
    reason: creditNote.reason ?? undefined,
    issueDate: formatIssueDate(creditNote.issueDate ?? new Date()),
    currency: creditNote.currency ?? DEFAULT_CURRENCY,
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
      addressLine: formatAddressLine(buyerAddress),
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
    },
  };
}

export type CreditNoteDerivedDocumentType = "credit_note" | "refund_document";

export type RenderedCreditNoteDocument = {
  html: string;
  creditNoteNumber: string;
  orderNumber: string;
  originalInvoiceNumber: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  documentType: CreditNoteDerivedDocumentType;
};

/**
 * Shared CreditNote → HTML for credit_note or refund_document (G5/G7).
 * Same mapper data; documentType drives template resolution and labels.
 * No QR (Group 13).
 */
async function renderCreditNoteDerivedDocument(
  shopDomain: string,
  creditNoteId: string,
  templateId: string | undefined,
  documentType: CreditNoteDerivedDocumentType,
): Promise<RenderedCreditNoteDocument | null> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const creditNote = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, storeId: store.id },
  });
  if (!creditNote) return null;

  const invoice = await prisma.invoice.findUnique({
    where: { id: creditNote.invoiceId },
  });

  const resolved = await resolveTemplateForShop(
    shopDomain,
    templateId,
    documentType,
  );
  if (!resolved) return null;

  const layout = (resolved.template.baseLayoutCode ?? "modern") as BaseLayoutCode;
  const originalInvoiceNumber = invoice?.invoiceNumber ?? "—";
  const orderNumber = invoice?.shopifyOrderNumber ?? undefined;
  const data = creditNoteToRenderData(
    creditNote,
    originalInvoiceNumber,
    orderNumber,
  );
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
    { pintStrict: store.invoiceMode === "compliance" },
  );

  return {
    html,
    creditNoteNumber: creditNote.creditNoteNumber,
    orderNumber: orderNumber ?? creditNote.creditNoteNumber,
    originalInvoiceNumber,
    templateId: resolved.template.id,
    templateCode: resolved.template.code,
    templateName: resolved.template.name,
    documentType,
  };
}

/** Render credit_note HTML from an existing CreditNote. */
export async function renderCreditNoteDocument(
  shopDomain: string,
  creditNoteId: string,
  templateId?: string,
): Promise<RenderedCreditNoteDocument | null> {
  return renderCreditNoteDerivedDocument(
    shopDomain,
    creditNoteId,
    templateId,
    "credit_note",
  );
}

/** Render refund_document HTML from the same CreditNote record. */
export async function renderRefundDocument(
  shopDomain: string,
  creditNoteId: string,
  templateId?: string,
): Promise<RenderedCreditNoteDocument | null> {
  return renderCreditNoteDerivedDocument(
    shopDomain,
    creditNoteId,
    templateId,
    "refund_document",
  );
}

export async function renderCreditNoteDocumentPdf(
  shopDomain: string,
  creditNoteId: string,
  templateId?: string,
): Promise<{ pdf: Buffer; doc: RenderedCreditNoteDocument } | null> {
  const doc = await renderCreditNoteDocument(
    shopDomain,
    creditNoteId,
    templateId,
  );
  if (!doc) return null;
  const a4 = applyA4DocumentLayout(doc.html);
  const pdf = await cachedHtmlToPdfBuffer(a4);
  return { pdf, doc };
}

export async function renderRefundDocumentPdf(
  shopDomain: string,
  creditNoteId: string,
  templateId?: string,
): Promise<{ pdf: Buffer; doc: RenderedCreditNoteDocument } | null> {
  const doc = await renderRefundDocument(shopDomain, creditNoteId, templateId);
  if (!doc) return null;
  const a4 = applyA4DocumentLayout(doc.html);
  const pdf = await cachedHtmlToPdfBuffer(a4);
  return { pdf, doc };
}

async function renderCreditNoteDerivedBulk(
  shopDomain: string,
  creditNoteIds: string[],
  templateId: string | undefined,
  documentType: CreditNoteDerivedDocumentType,
): Promise<{
  html: string;
  count: number;
  creditNoteNumbers: string[];
  templateId: string;
  templateName: string;
  templateCode: string;
} | null> {
  const uniqueIds = [
    ...new Set(creditNoteIds.map((id) => String(id).trim()).filter(Boolean)),
  ];
  if (uniqueIds.length === 0) return null;

  const rendered = await mapWithConcurrency(
    uniqueIds,
    BULK_RENDER_CONCURRENCY,
    (id) =>
      renderCreditNoteDerivedDocument(
        shopDomain,
        id,
        templateId,
        documentType,
      ),
  );

  const docs: string[] = [];
  const numbers: string[] = [];
  let templateMeta: {
    templateId: string;
    templateName: string;
    templateCode: string;
  } | null = null;

  for (const doc of rendered) {
    if (!doc) continue;
    docs.push(doc.html);
    numbers.push(doc.creditNoteNumber);
    templateMeta = {
      templateId: doc.templateId,
      templateName: doc.templateName,
      templateCode: doc.templateCode,
    };
  }

  if (!docs.length || !templateMeta) return null;

  return {
    html: mergeDocumentHtml(
      docs,
      documentType === "refund_document" ? "Refund Documents" : "Credit Notes",
    ),
    count: docs.length,
    creditNoteNumbers: numbers,
    ...templateMeta,
  };
}

export async function renderCreditNotesBulk(
  shopDomain: string,
  creditNoteIds: string[],
  templateId?: string,
) {
  return renderCreditNoteDerivedBulk(
    shopDomain,
    creditNoteIds,
    templateId,
    "credit_note",
  );
}

export async function renderRefundDocumentsBulk(
  shopDomain: string,
  creditNoteIds: string[],
  templateId?: string,
) {
  return renderCreditNoteDerivedBulk(
    shopDomain,
    creditNoteIds,
    templateId,
    "refund_document",
  );
}

export async function renderCreditNotesBulkPdf(
  shopDomain: string,
  creditNoteIds: string[],
  templateId?: string,
): Promise<{
  pdf: Buffer;
  count: number;
  templateId: string;
  templateName: string;
} | null> {
  const bulk = await renderCreditNotesBulk(
    shopDomain,
    creditNoteIds,
    templateId,
  );
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

export async function renderRefundDocumentsBulkPdf(
  shopDomain: string,
  creditNoteIds: string[],
  templateId?: string,
): Promise<{
  pdf: Buffer;
  count: number;
  templateId: string;
  templateName: string;
} | null> {
  const bulk = await renderRefundDocumentsBulk(
    shopDomain,
    creditNoteIds,
    templateId,
  );
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

/**
 * Shared download recording for credit_note / refund_document.
 * generated|ready → downloaded; always creates InvoiceStatusEvent.
 */
async function recordCreditNoteDerivedDownload(
  shopDomain: string,
  creditNoteId: string,
  templateId: string,
  templateName: string,
  documentType: CreditNoteDerivedDocumentType,
): Promise<void> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return;

  const creditNote = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, storeId: store.id },
  });
  if (!creditNote) return;

  if (creditNote.status === "generated" || creditNote.status === "ready") {
    await prisma.creditNote.update({
      where: { id: creditNote.id },
      data: { status: "downloaded" },
    });
  }

  const label =
    documentType === "refund_document" ? "Refund document" : "Credit note";
  await prisma.invoiceStatusEvent.create({
    data: {
      invoiceId: creditNote.invoiceId,
      creditNoteId: creditNote.id,
      status: "downloaded",
      source: "merchant",
      message: `${label} downloaded using ${templateName} template`,
      metadata: {
        templateId,
        templateName,
        documentType,
      },
    },
  });
}

export async function recordCreditNoteDownload(
  shopDomain: string,
  creditNoteId: string,
  templateId: string,
  templateName: string,
): Promise<void> {
  return recordCreditNoteDerivedDownload(
    shopDomain,
    creditNoteId,
    templateId,
    templateName,
    "credit_note",
  );
}

export async function recordRefundDocumentDownload(
  shopDomain: string,
  creditNoteId: string,
  templateId: string,
  templateName: string,
): Promise<void> {
  return recordCreditNoteDerivedDownload(
    shopDomain,
    creditNoteId,
    templateId,
    templateName,
    "refund_document",
  );
}

export type CreditNoteTemplateOption = {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
};

/** Active credit_note templates for the shop (system + store customs). */
export async function listCreditNoteTemplatesForShop(
  shopDomain: string,
): Promise<CreditNoteTemplateOption[] | null> {
  await ensureSystemTemplates();
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const templates = await prisma.invoiceTemplate.findMany({
    where: {
      isActive: true,
      documentType: "credit_note",
      OR: [{ isSystem: true }, { storeId: store.id }],
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    isDefault: store.defaultCreditNoteTemplateId === t.id,
  }));
}

/** Active refund_document templates for the shop (system + store customs). */
export async function listRefundDocumentTemplatesForShop(
  shopDomain: string,
): Promise<CreditNoteTemplateOption[] | null> {
  await ensureSystemTemplates();
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const templates = await prisma.invoiceTemplate.findMany({
    where: {
      isActive: true,
      documentType: "refund_document",
      OR: [{ isSystem: true }, { storeId: store.id }],
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    isDefault: store.defaultRefundDocumentTemplateId === t.id,
  }));
}

export type CreditNoteDetailsData = {
  id: string;
  creditNoteNumber: string;
  originalInvoiceNumber: string;
  originalInvoiceId: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  buyerName: string;
  reason: string | null;
  issueDateIso: string;
  status: string;
  financialStatus: string | null;
  currency: string;
  grandTotal: number;
  shopDomain: string;
  previewEmbedUrl: string;
  printUrl: string;
  downloadUrl: string;
};

/**
 * Load credit note metadata for the Polaris details page.
 * Document HTML/PDF continue to come from renderCreditNoteDocument* (G5/G7).
 */
export async function getCreditNoteDetailsForShop(
  shopDomain: string,
  creditNoteId: string,
): Promise<CreditNoteDetailsData | null> {
  const store = await getActiveStoreForShop(shopDomain);
  if (!store) return null;

  const creditNote = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, storeId: store.id },
  });
  if (!creditNote) return null;

  const invoice: Invoice | null = await prisma.invoice.findUnique({
    where: { id: creditNote.invoiceId },
  });
  const buyer = parseJson<{ name?: string | null }>(creditNote.buyer, {});
  const totals = parseJson<{ grandTotal?: number }>(creditNote.totals, {});
  const encodedId = encodeURIComponent(creditNote.id);

  return {
    id: creditNote.id,
    creditNoteNumber: creditNote.creditNoteNumber,
    originalInvoiceNumber: invoice?.invoiceNumber ?? "—",
    originalInvoiceId: creditNote.invoiceId,
    shopifyOrderId: creditNote.shopifyOrderId,
    shopifyOrderNumber: invoice?.shopifyOrderNumber ?? "—",
    buyerName: buyer.name?.trim() || "Customer",
    reason: creditNote.reason,
    issueDateIso: creditNote.issueDate.toISOString(),
    status: creditNote.status,
    financialStatus: invoice?.financialStatus ?? null,
    currency: creditNote.currency || DEFAULT_CURRENCY,
    grandTotal: totals.grandTotal ?? 0,
    shopDomain: store.shopifyDomain,
    previewEmbedUrl: `/app/credit-notes/${encodedId}/view?embed=1`,
    printUrl: `/app/credit-notes/${encodedId}/view?embed=1`,
    downloadUrl: `/app/credit-notes/${encodedId}/download`,
  };
}

/**
 * Same CreditNote metadata for Refund Document details; refund_document URLs.
 */
export async function getRefundDocumentDetailsForShop(
  shopDomain: string,
  creditNoteId: string,
): Promise<CreditNoteDetailsData | null> {
  const base = await getCreditNoteDetailsForShop(shopDomain, creditNoteId);
  if (!base) return null;
  const encodedId = encodeURIComponent(base.id);
  return {
    ...base,
    previewEmbedUrl: `/app/credit-notes/${encodedId}/refund-document/view?embed=1`,
    printUrl: `/app/credit-notes/${encodedId}/refund-document/view?embed=1`,
    downloadUrl: `/app/credit-notes/${encodedId}/refund-document`,
  };
}

/** Old single refund PDF basename: refund-{creditNoteNumber} */
export function refundDocumentPdfBasename(creditNoteNumber: string): string {
  return `refund-${creditNoteNumber}`;
}
