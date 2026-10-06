/**
 * Group 12 document email — delivery settings, send, events, idempotency.
 * Customer document email uses Resend (not Help SMTP).
 *
 * Auto-send is gated only by per-document settings (invoiceAutoSend,
 * creditNoteAutoSend, refundDocumentAutoSend) and invoiceWhen.
 * The stored `enabled` field is kept for data compatibility but does NOT
 * control automatic document emails (intentional product decision).
 *
 * Public links are optional (Group 13); send continues without them.
 */

import type { Prisma } from "@prisma/client";

import prisma from "../db.server";
import { getBrandingForShop, type StoreBrandingData } from "./branding.server";
import {
  renderCreditNoteDocumentPdf,
  renderRefundDocumentPdf,
} from "./credit-note-document.server";
import {
  DEFAULT_CREDIT_NOTE_EMAIL_BODY,
  DEFAULT_CUSTOM_CREDIT_NOTE_EMAIL_BODY,
  DEFAULT_CUSTOM_INVOICE_EMAIL_BODY,
  DEFAULT_CUSTOM_REFUND_EMAIL_BODY,
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_REFUND_EMAIL_BODY,
  normalizeEmailBodyContent,
  normalizeEmailBodyMode,
  normalizeEmailLayout,
  resolveEmailBodiesForSend,
  sanitizeCustomEmailHtml,
  renderBrandedEmail,
  type EmailBodyMode,
  type EmailDocumentKind,
  type EmailLayout,
} from "./email-template.server";
import { renderInvoiceDocumentPdf } from "./invoice-document.server";
import { pdfFilename } from "./pdf-cache.server";
import {
  issueCreditNotePublicLinkForShop,
  issueInvoicePublicLinkForShop,
} from "./public-link.server";
import {
  deliverViaResend,
  getEmailProviderStatus,
  isResendConfigured,
} from "./resend.server";

export { getEmailProviderStatus };
export { isResendConfigured as isEmailProviderConfigured };

// ---------------------------------------------------------------------------
// Auto-send schedule (per-document gates only — global `enabled` ignored)
// ---------------------------------------------------------------------------

export type ScheduleInvoiceAutoEmail = (
  shopDomain: string,
  invoiceId: string,
  orderIsPaid: boolean,
) => Promise<void>;

export type ScheduleInvoiceAutoEmailOnPaid = (
  shopDomain: string,
  invoiceId: string,
) => Promise<void>;

/** True when invoice auto-send should run for this create/paid context. */
export function shouldAutoSendInvoice(
  settings: Pick<DeliverySettings, "invoiceAutoSend" | "invoiceWhen">,
  orderIsPaid: boolean,
): boolean {
  if (!settings.invoiceAutoSend) return false;
  if (settings.invoiceWhen === "paid" && !orderIsPaid) return false;
  return true;
}

/** True when orders/paid should trigger invoice auto-send. */
export function shouldAutoSendInvoiceOnPaid(
  settings: Pick<DeliverySettings, "invoiceAutoSend" | "invoiceWhen">,
): boolean {
  return Boolean(settings.invoiceAutoSend && settings.invoiceWhen === "paid");
}

export function shouldAutoSendCreditNote(
  settings: Pick<DeliverySettings, "creditNoteAutoSend">,
): boolean {
  return Boolean(settings.creditNoteAutoSend);
}

export function shouldAutoSendRefundDocument(
  settings: Pick<DeliverySettings, "refundDocumentAutoSend">,
): boolean {
  return Boolean(settings.refundDocumentAutoSend);
}

async function recordProviderMissingFailure(
  invoiceId: string,
  documentType: DocumentEmailType,
  creditNoteId?: string,
) {
  await recordEmailEvent({
    invoiceId,
    creditNoteId,
    status: "email_failed",
    message:
      "Email not sent: RESEND_API_KEY or EMAIL_FROM is not configured on the server",
    metadata: {
      documentType,
      trigger: "auto",
      error: "RESEND_API_KEY or EMAIL_FROM not configured",
    },
    source: "system",
  });
}

async function defaultScheduleInvoiceAutoEmail(
  shopDomain: string,
  invoiceId: string,
  orderIsPaid: boolean,
): Promise<void> {
  try {
    const settings = await getDeliverySettings(shopDomain);
    if (!settings) return;

    if (!shouldAutoSendInvoice(settings, orderIsPaid)) {
      if (!settings.invoiceAutoSend) {
        console.log(
          `[email] skip invoice auto-send for ${invoiceId}: invoiceAutoSend disabled`,
        );
      } else {
        console.log(
          `[email] skip invoice auto-send for ${invoiceId}: waiting for order paid (invoiceWhen=paid)`,
        );
      }
      return;
    }

    if (await hasEmailSentEvent(invoiceId, "tax_invoice")) {
      console.log(
        `[email] skip invoice auto-send for ${invoiceId}: already emailed`,
      );
      return;
    }

    if (!isResendConfigured()) {
      console.warn(
        `[email] invoice auto-send blocked for ${invoiceId}: RESEND_API_KEY or EMAIL_FROM not configured`,
      );
      await recordProviderMissingFailure(invoiceId, "tax_invoice");
      return;
    }

    console.log(
      `[email] auto-sending invoice ${invoiceId} (orderPaid=${orderIsPaid})`,
    );
    const result = await sendInvoiceEmail({
      shop: shopDomain,
      invoiceId,
      trigger: "auto",
    });
    if (!result.ok) {
      console.warn(
        `[email] invoice auto-send failed for ${invoiceId}: ${result.error}`,
      );
    } else if (!result.skipped) {
      console.log(
        `[email] invoice auto-send ok for ${invoiceId} → ${result.to}`,
      );
    }
  } catch (error) {
    console.error(`[email] invoice auto-send error for ${invoiceId}:`, error);
  }
}

async function defaultScheduleInvoiceAutoEmailOnPaid(
  shopDomain: string,
  invoiceId: string,
): Promise<void> {
  try {
    const settings = await getDeliverySettings(shopDomain);
    if (!settings) return;

    if (!shouldAutoSendInvoiceOnPaid(settings)) {
      if (!settings.invoiceAutoSend) {
        console.log(
          `[email] skip paid auto-send for ${invoiceId}: invoiceAutoSend disabled`,
        );
      } else {
        console.log(
          `[email] skip paid auto-send for ${invoiceId}: invoiceWhen=${settings.invoiceWhen}`,
        );
      }
      return;
    }

    if (await hasEmailSentEvent(invoiceId, "tax_invoice")) {
      console.log(
        `[email] skip paid auto-send for ${invoiceId}: already emailed`,
      );
      return;
    }

    if (!isResendConfigured()) {
      console.warn(
        `[email] paid auto-send blocked for ${invoiceId}: RESEND_API_KEY or EMAIL_FROM not configured`,
      );
      await recordProviderMissingFailure(invoiceId, "tax_invoice");
      return;
    }

    console.log(`[email] auto-sending invoice on paid ${invoiceId}`);
    const result = await sendInvoiceEmail({
      shop: shopDomain,
      invoiceId,
      trigger: "auto",
    });
    if (!result.ok) {
      console.warn(
        `[email] invoice paid auto-send failed for ${invoiceId}: ${result.error}`,
      );
    } else if (!result.skipped) {
      console.log(
        `[email] invoice paid auto-send ok for ${invoiceId} → ${result.to}`,
      );
    }
  } catch (error) {
    console.error(
      `[email] invoice paid auto-send error for ${invoiceId}:`,
      error,
    );
  }
}

let scheduleInvoiceAutoEmailImpl: ScheduleInvoiceAutoEmail =
  defaultScheduleInvoiceAutoEmail;
let scheduleInvoiceAutoEmailOnPaidImpl: ScheduleInvoiceAutoEmailOnPaid =
  defaultScheduleInvoiceAutoEmailOnPaid;

/** Injectable for tests — restoreDocumentEmailHooks() restores production defaults. */
export function setDocumentEmailHooks(hooks: {
  scheduleInvoiceAutoEmail?: ScheduleInvoiceAutoEmail;
  scheduleInvoiceAutoEmailOnPaid?: ScheduleInvoiceAutoEmailOnPaid;
}): void {
  if (hooks.scheduleInvoiceAutoEmail) {
    scheduleInvoiceAutoEmailImpl = hooks.scheduleInvoiceAutoEmail;
  }
  if (hooks.scheduleInvoiceAutoEmailOnPaid) {
    scheduleInvoiceAutoEmailOnPaidImpl = hooks.scheduleInvoiceAutoEmailOnPaid;
  }
}

export function restoreDocumentEmailHooks(): void {
  scheduleInvoiceAutoEmailImpl = defaultScheduleInvoiceAutoEmail;
  scheduleInvoiceAutoEmailOnPaidImpl = defaultScheduleInvoiceAutoEmailOnPaid;
  documentLinkResolver = defaultDocumentLinkResolver;
}

export async function scheduleInvoiceAutoEmail(
  shopDomain: string,
  invoiceId: string,
  orderIsPaid: boolean,
): Promise<void> {
  await scheduleInvoiceAutoEmailImpl(shopDomain, invoiceId, orderIsPaid);
}

export async function scheduleInvoiceAutoEmailOnPaid(
  shopDomain: string,
  invoiceId: string,
): Promise<void> {
  await scheduleInvoiceAutoEmailOnPaidImpl(shopDomain, invoiceId);
}

/**
 * Auto-send credit note and/or refund document after credit-note create.
 * Each document type uses only its own auto-send flag (global `enabled` ignored).
 * Both may send on the same CreditNote when both flags are enabled.
 */
export async function scheduleCreditNoteAutoEmails(
  shopDomain: string,
  creditNoteId: string,
): Promise<void> {
  try {
    const settings = await getDeliverySettings(shopDomain);
    if (!settings) return;

    const wantsCn = shouldAutoSendCreditNote(settings);
    const wantsRefund = shouldAutoSendRefundDocument(settings);
    if (!wantsCn && !wantsRefund) return;

    const creditNote = await prisma.creditNote.findUnique({
      where: { id: creditNoteId },
      select: { id: true, invoiceId: true },
    });
    if (!creditNote) return;
    const invoiceId = creditNote.invoiceId;

    if (!isResendConfigured()) {
      console.warn(
        `[email] credit-note auto-send blocked for ${creditNoteId}: RESEND_API_KEY or EMAIL_FROM not configured`,
      );
      if (wantsCn) {
        await recordProviderMissingFailure(invoiceId, "credit_note", creditNoteId);
      }
      if (wantsRefund) {
        await recordProviderMissingFailure(
          invoiceId,
          "refund_document",
          creditNoteId,
        );
      }
      return;
    }

    if (
      wantsCn &&
      !(await hasEmailSentEvent(invoiceId, "credit_note", creditNoteId))
    ) {
      console.log(`[email] auto-sending credit note ${creditNoteId}`);
      const result = await sendCreditNoteEmail({
        shop: shopDomain,
        creditNoteId,
        trigger: "auto",
      });
      if (!result.ok) {
        console.warn(
          `[email] credit note auto-send failed for ${creditNoteId}: ${result.error}`,
        );
      }
    }

    if (
      wantsRefund &&
      !(await hasEmailSentEvent(invoiceId, "refund_document", creditNoteId))
    ) {
      console.log(`[email] auto-sending refund document ${creditNoteId}`);
      const result = await sendRefundDocumentEmail({
        shop: shopDomain,
        creditNoteId,
        trigger: "auto",
      });
      if (!result.ok) {
        console.warn(
          `[email] refund document auto-send failed for ${creditNoteId}: ${result.error}`,
        );
      }
    }
  } catch (error) {
    console.error(
      `[email] credit note auto-send error for ${creditNoteId}:`,
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// Public link injection (Group 13 Phase D — Phase A helpers)
// ---------------------------------------------------------------------------

export type DocumentEmailType = "tax_invoice" | "credit_note" | "refund_document";
export type EmailTrigger = "auto" | "manual" | "test";
export type EmailInvoiceWhen = "created" | "paid";

export type DocumentLinkResolver = (args: {
  shopDomain: string;
  documentType: DocumentEmailType;
  invoiceId: string;
  creditNoteId?: string;
}) => Promise<string | null>;

/** Production resolver — Phase A public-link helpers (Group 13 Phase D). */
const defaultDocumentLinkResolver: DocumentLinkResolver = async (args) => {
  try {
    if (args.documentType === "tax_invoice") {
      const result = await issueInvoicePublicLinkForShop(
        args.shopDomain,
        args.invoiceId,
      );
      return result?.url ?? null;
    }

    const creditNoteId = args.creditNoteId?.trim();
    if (!creditNoteId) return null;

    const documentType =
      args.documentType === "refund_document"
        ? "refund_document"
        : "credit_note";
    const result = await issueCreditNotePublicLinkForShop(
      args.shopDomain,
      creditNoteId,
      documentType,
    );
    return result?.url ?? null;
  } catch (error) {
    console.warn("[email] public link resolver failed:", error);
    return null;
  }
};

let documentLinkResolver: DocumentLinkResolver = defaultDocumentLinkResolver;

/** Override for tests. Pass null to restore the production resolver. */
export function setDocumentEmailLinkResolver(
  resolver: DocumentLinkResolver | null,
): void {
  documentLinkResolver = resolver ?? defaultDocumentLinkResolver;
}

// ---------------------------------------------------------------------------
// Delivery settings
// ---------------------------------------------------------------------------

export interface DeliverySettings {
  /**
   * Legacy field retained for stored-data compatibility.
   * Does NOT control automatic document emails in the new app.
   */
  enabled: boolean;
  invoiceAutoSend: boolean;
  invoiceWhen: EmailInvoiceWhen;
  creditNoteAutoSend: boolean;
  refundDocumentAutoSend: boolean;
  ccStaff: string;
  fromName: string;
  replyTo: string;
  emailLayout: EmailLayout;
  showViewButton: boolean;
  invoiceBodyMode: EmailBodyMode;
  invoiceSubject: string;
  invoiceBody: string;
  invoiceBodyCustom: string;
  creditNoteBodyMode: EmailBodyMode;
  creditNoteSubject: string;
  creditNoteBody: string;
  creditNoteBodyCustom: string;
  refundBodyMode: EmailBodyMode;
  refundSubject: string;
  refundBody: string;
  refundBodyCustom: string;
}

const SETTING_KEY = "delivery_settings";

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  enabled: false,
  invoiceAutoSend: false,
  invoiceWhen: "paid",
  creditNoteAutoSend: false,
  refundDocumentAutoSend: false,
  ccStaff: "",
  fromName: "",
  replyTo: "",
  emailLayout: "classic",
  showViewButton: true,
  invoiceBodyMode: "designed",
  invoiceSubject: "Your invoice {{invoice_number}} from {{shop_name}}",
  invoiceBody: DEFAULT_INVOICE_EMAIL_BODY,
  invoiceBodyCustom: DEFAULT_CUSTOM_INVOICE_EMAIL_BODY,
  creditNoteBodyMode: "designed",
  creditNoteSubject: "Your credit note {{credit_note_number}} from {{shop_name}}",
  creditNoteBody: DEFAULT_CREDIT_NOTE_EMAIL_BODY,
  creditNoteBodyCustom: DEFAULT_CUSTOM_CREDIT_NOTE_EMAIL_BODY,
  refundBodyMode: "designed",
  refundSubject: "Your refund document {{credit_note_number}} from {{shop_name}}",
  refundBody: DEFAULT_REFUND_EMAIL_BODY,
  refundBodyCustom: DEFAULT_CUSTOM_REFUND_EMAIL_BODY,
};

const LEGACY_CREDIT_NOTE_BODY =
  "Hi {{customer_name}},\n\nPlease find your credit note {{credit_note_number}} for order {{order_number}} attached.\n\nThank you,\n{{shop_name}}";
const LEGACY_REFUND_BODY =
  "Hi {{customer_name}},\n\nPlease find your refund document {{credit_note_number}} for order {{order_number}} attached.\n\nThank you,\n{{shop_name}}";

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === "on") return true;
  if (value === "false" || value === "0" || value === "off") return false;
  return fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeInvoiceWhen(value: unknown): EmailInvoiceWhen {
  return value === "created" ? "created" : "paid";
}

function migrateLegacyBody(
  current: string,
  legacy: string,
  next: string,
): string {
  return current.trim() === legacy.trim() ? next : current;
}

export function normalizeDeliverySettings(raw: unknown): DeliverySettings {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: asBool(data.enabled, DEFAULT_DELIVERY_SETTINGS.enabled),
    invoiceAutoSend: asBool(
      data.invoiceAutoSend,
      DEFAULT_DELIVERY_SETTINGS.invoiceAutoSend,
    ),
    invoiceWhen: normalizeInvoiceWhen(data.invoiceWhen),
    creditNoteAutoSend: asBool(
      data.creditNoteAutoSend,
      DEFAULT_DELIVERY_SETTINGS.creditNoteAutoSend,
    ),
    refundDocumentAutoSend: asBool(
      data.refundDocumentAutoSend,
      DEFAULT_DELIVERY_SETTINGS.refundDocumentAutoSend,
    ),
    ccStaff: asString(data.ccStaff, DEFAULT_DELIVERY_SETTINGS.ccStaff),
    fromName: asString(data.fromName, DEFAULT_DELIVERY_SETTINGS.fromName),
    replyTo: asString(data.replyTo, DEFAULT_DELIVERY_SETTINGS.replyTo),
    emailLayout: normalizeEmailLayout(data.emailLayout),
    showViewButton: asBool(
      data.showViewButton,
      DEFAULT_DELIVERY_SETTINGS.showViewButton,
    ),
    invoiceBodyMode: normalizeEmailBodyMode(data.invoiceBodyMode),
    invoiceSubject: asString(
      data.invoiceSubject,
      DEFAULT_DELIVERY_SETTINGS.invoiceSubject,
    ),
    invoiceBody: normalizeEmailBodyContent(
      asString(data.invoiceBody, DEFAULT_DELIVERY_SETTINGS.invoiceBody),
    ),
    invoiceBodyCustom: sanitizeCustomEmailHtml(
      asString(data.invoiceBodyCustom, DEFAULT_DELIVERY_SETTINGS.invoiceBodyCustom),
    ),
    creditNoteBodyMode: normalizeEmailBodyMode(data.creditNoteBodyMode),
    creditNoteSubject: asString(
      data.creditNoteSubject,
      DEFAULT_DELIVERY_SETTINGS.creditNoteSubject,
    ),
    creditNoteBody: normalizeEmailBodyContent(
      migrateLegacyBody(
        asString(data.creditNoteBody, DEFAULT_DELIVERY_SETTINGS.creditNoteBody),
        LEGACY_CREDIT_NOTE_BODY,
        DEFAULT_DELIVERY_SETTINGS.creditNoteBody,
      ),
    ),
    creditNoteBodyCustom: sanitizeCustomEmailHtml(
      asString(
        data.creditNoteBodyCustom,
        DEFAULT_DELIVERY_SETTINGS.creditNoteBodyCustom,
      ),
    ),
    refundBodyMode: normalizeEmailBodyMode(data.refundBodyMode),
    refundSubject: asString(
      data.refundSubject,
      DEFAULT_DELIVERY_SETTINGS.refundSubject,
    ),
    refundBody: normalizeEmailBodyContent(
      migrateLegacyBody(
        asString(data.refundBody, DEFAULT_DELIVERY_SETTINGS.refundBody),
        LEGACY_REFUND_BODY,
        DEFAULT_DELIVERY_SETTINGS.refundBody,
      ),
    ),
    refundBodyCustom: sanitizeCustomEmailHtml(
      asString(data.refundBodyCustom, DEFAULT_DELIVERY_SETTINGS.refundBodyCustom),
    ),
  };
}

export function parseCcList(ccStaff: string): string[] {
  return ccStaff
    .split(/[,;\s]+/)
    .map((email) => email.trim())
    .filter((email) => email.includes("@"));
}

export function applyPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
    return vars[key] ?? "";
  });
}

export function emailFieldsForKind(
  settings: DeliverySettings,
  documentKind: EmailDocumentKind,
): {
  bodyMode: EmailBodyMode;
  subjectTemplate: string;
  designedTemplate: string;
  customTemplate: string;
} {
  if (documentKind === "credit_note") {
    return {
      bodyMode: settings.creditNoteBodyMode,
      subjectTemplate: settings.creditNoteSubject,
      designedTemplate: settings.creditNoteBody,
      customTemplate: settings.creditNoteBodyCustom,
    };
  }
  if (documentKind === "refund") {
    return {
      bodyMode: settings.refundBodyMode,
      subjectTemplate: settings.refundSubject,
      designedTemplate: settings.refundBody,
      customTemplate: settings.refundBodyCustom,
    };
  }
  return {
    bodyMode: settings.invoiceBodyMode,
    subjectTemplate: settings.invoiceSubject,
    designedTemplate: settings.invoiceBody,
    customTemplate: settings.invoiceBodyCustom,
  };
}

async function resolveStore(shopDomain: string) {
  return prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
}

async function resolveSenderFallbacks(
  store: { id: string; merchantId: string; shopifyDomain: string; defaultLegalEntityId: string | null },
  settings: DeliverySettings,
): Promise<DeliverySettings> {
  if (settings.fromName && settings.replyTo) return settings;

  const legalEntity = store.defaultLegalEntityId
    ? await prisma.legalEntity.findUnique({
        where: { id: store.defaultLegalEntityId },
      })
    : await prisma.legalEntity.findFirst({
        where: { merchantId: store.merchantId },
        orderBy: { createdAt: "asc" },
      });

  const next = { ...settings };
  if (!next.fromName) {
    next.fromName =
      legalEntity?.legalName ||
      store.shopifyDomain.replace(".myshopify.com", "");
  }
  if (!next.replyTo) {
    next.replyTo = legalEntity?.businessEmail || "";
  }
  return next;
}

export async function getDeliverySettings(
  shopDomain: string,
): Promise<DeliverySettings | null> {
  const store = await resolveStore(shopDomain);
  if (!store) return null;

  const setting = await prisma.setting.findFirst({
    where: { storeId: store.id, key: SETTING_KEY },
  });

  let settings = normalizeDeliverySettings(setting?.value);
  settings = await resolveSenderFallbacks(store, settings);
  return settings;
}

export async function saveDeliverySettings(
  shopDomain: string,
  input: Partial<DeliverySettings>,
): Promise<DeliverySettings | null> {
  const store = await resolveStore(shopDomain);
  if (!store) return null;

  const current =
    (await getDeliverySettings(shopDomain)) ?? DEFAULT_DELIVERY_SETTINGS;
  const next = normalizeDeliverySettings({ ...current, ...input });

  await prisma.setting.upsert({
    where: {
      merchantId_storeId_key: {
        merchantId: store.merchantId,
        storeId: store.id,
        key: SETTING_KEY,
      },
    },
    create: {
      merchantId: store.merchantId,
      storeId: store.id,
      scope: "store",
      key: SETTING_KEY,
      value: next as unknown as Prisma.InputJsonValue,
    },
    update: {
      value: next as unknown as Prisma.InputJsonValue,
    },
  });

  return next;
}

// ---------------------------------------------------------------------------
// Idempotency + events
// ---------------------------------------------------------------------------

/** Idempotency: skip auto-send if email_sent already exists for this doc + type. */
export async function hasEmailSentEvent(
  invoiceId: string,
  documentType: DocumentEmailType,
  creditNoteId?: string,
): Promise<boolean> {
  const events = await prisma.invoiceStatusEvent.findMany({
    where: {
      invoiceId,
      status: "email_sent",
      ...(creditNoteId ? { creditNoteId } : {}),
    },
    select: { id: true, metadata: true },
  });

  return events.some((event) => {
    const meta = (event.metadata ?? {}) as { documentType?: string };
    return meta.documentType === documentType;
  });
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
  to?: string;
  providerId?: string;
  from?: string;
  lastEvent?: string;
  skipped?: boolean;
}

async function recordEmailEvent(options: {
  invoiceId: string;
  creditNoteId?: string;
  status: "email_sent" | "email_failed";
  message: string;
  metadata: Record<string, unknown>;
  source: "system" | "merchant";
}) {
  await prisma.invoiceStatusEvent.create({
    data: {
      invoiceId: options.invoiceId,
      creditNoteId: options.creditNoteId,
      status: options.status,
      source: options.source,
      message: options.message,
      metadata: options.metadata as Prisma.InputJsonValue,
    },
  });
}

function eventSourceForTrigger(
  trigger: EmailTrigger,
): "system" | "merchant" {
  return trigger === "manual" || trigger === "test" ? "merchant" : "system";
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

const FALLBACK_BRANDING: StoreBrandingData = {
  primaryColor: "#0d5c45",
  secondaryColor: "#6b7280",
  accentColor: "#0d5c45",
  logoUrl: "",
  footerText: "Thank you for your business",
  socialLinks: { visible: false, links: [] },
};

async function composeEmailBodies(options: {
  shop: string;
  settings: DeliverySettings;
  documentKind: EmailDocumentKind;
  bodyMode: EmailBodyMode;
  designedBody: string;
  customBody: string;
  documentLink?: string;
}): Promise<{ html: string; text: string }> {
  const resolved = resolveEmailBodiesForSend({
    documentKind: options.documentKind,
    bodyMode: options.bodyMode,
    designedBody: options.designedBody,
    customBody: options.customBody,
  });

  const branding =
    (await getBrandingForShop(options.shop)) ?? FALLBACK_BRANDING;

  return renderBrandedEmail({
    layout: options.settings.emailLayout,
    showViewButton: options.settings.showViewButton,
    documentKind: options.documentKind,
    bodyMode: options.bodyMode,
    bodyContent: resolved.designedBody,
    customBodyContent: resolved.customBody,
    shopName: options.settings.fromName || options.shop,
    documentLink: options.documentLink,
    branding,
  });
}

function sampleEmailVars(
  settings: DeliverySettings,
  shop: string,
  documentLink?: string,
): Record<string, string> {
  const link = documentLink || "https://example.com/documents/sample";
  return {
    invoice_number: "INV-10042",
    credit_note_number: "CN-10042",
    order_number: "#1042",
    shop_name: settings.fromName || shop,
    customer_name: "Alex Customer",
    invoice_link: documentLink || "https://example.com/invoices/sample",
    credit_note_link: documentLink || "https://example.com/credit-notes/sample",
    refund_link: documentLink || "https://example.com/refunds/sample",
    document_link: link,
  };
}

export async function previewDocumentEmail(options: {
  shop: string;
  settings: DeliverySettings;
  documentKind: EmailDocumentKind;
  bodyMode?: EmailBodyMode;
  bodyTemplate?: string;
  customBodyTemplate?: string;
  documentLink?: string;
}): Promise<{ html: string; text: string }> {
  const fields = emailFieldsForKind(options.settings, options.documentKind);
  const bodyMode = options.bodyMode ?? fields.bodyMode;
  const designedTemplate = options.bodyTemplate ?? fields.designedTemplate;
  const customTemplate = options.customBodyTemplate ?? fields.customTemplate;
  const sampleVars = sampleEmailVars(
    options.settings,
    options.shop,
    options.documentLink,
  );
  const documentLink =
    options.documentLink ||
    (options.documentKind === "invoice"
      ? sampleVars.invoice_link
      : options.documentKind === "credit_note"
        ? sampleVars.credit_note_link
        : sampleVars.refund_link);

  return composeEmailBodies({
    shop: options.shop,
    settings: options.settings,
    documentKind: options.documentKind,
    bodyMode,
    designedBody: applyPlaceholders(
      normalizeEmailBodyContent(designedTemplate),
      sampleVars,
    ),
    customBody: applyPlaceholders(
      sanitizeCustomEmailHtml(customTemplate),
      sampleVars,
    ),
    documentLink,
  });
}

export async function sendDocumentTestEmail(options: {
  shop: string;
  to: string;
  documentKind: EmailDocumentKind;
  settings: DeliverySettings;
  bodyMode?: EmailBodyMode;
  bodyTemplate?: string;
  customBodyTemplate?: string;
  subjectTemplate: string;
}): Promise<SendEmailResult> {
  const to = options.to.trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "Enter a valid email address for the test send" };
  }

  const fields = emailFieldsForKind(options.settings, options.documentKind);
  const bodyMode = options.bodyMode ?? fields.bodyMode;
  const designedTemplate = options.bodyTemplate ?? fields.designedTemplate;
  const customTemplate = options.customBodyTemplate ?? fields.customTemplate;

  const vars = sampleEmailVars(options.settings, options.shop);
  const documentLink =
    options.documentKind === "invoice"
      ? vars.invoice_link
      : options.documentKind === "credit_note"
        ? vars.credit_note_link
        : vars.refund_link;

  const subjectRaw = applyPlaceholders(options.subjectTemplate.trim(), vars);
  const subject = `[Test] ${subjectRaw}`.slice(0, 240);

  const emailBodies = await composeEmailBodies({
    shop: options.shop,
    settings: options.settings,
    documentKind: options.documentKind,
    bodyMode,
    designedBody: applyPlaceholders(
      normalizeEmailBodyContent(designedTemplate),
      vars,
    ),
    customBody: applyPlaceholders(sanitizeCustomEmailHtml(customTemplate), vars),
    documentLink,
  });

  const testNote =
    `<p style="margin:0 0 16px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-family:system-ui,sans-serif;font-size:12px;color:#92400e;">This is a <strong>test email</strong> from PDF Invoice Generator CG — sample data only, no PDF attached.</p>`;
  const html = emailBodies.html.replace(/<body([^>]*)>/i, `<body$1>${testNote}`);

  const sent = await deliverViaResend({
    to,
    cc: [],
    fromName: options.settings.fromName,
    replyTo: options.settings.replyTo || undefined,
    subject,
    text: `[Test email — sample data, no PDF attached]\n\n${emailBodies.text}`,
    html,
  });

  if (!sent.ok) return { ok: false, error: sent.error, to };
  return {
    ok: true,
    to,
    providerId: sent.id,
    from: sent.from,
    lastEvent: sent.lastEvent,
  };
}

// ---------------------------------------------------------------------------
// Document sends
// ---------------------------------------------------------------------------

type BuyerSnapshot = { name?: string; email?: string };

function readBuyer(value: unknown): BuyerSnapshot {
  const buyer = (value ?? {}) as BuyerSnapshot;
  return {
    name: typeof buyer.name === "string" ? buyer.name : undefined,
    email: typeof buyer.email === "string" ? buyer.email : undefined,
  };
}

export async function sendInvoiceEmail(options: {
  shop: string;
  invoiceId: string;
  templateId?: string;
  to?: string;
  trigger: EmailTrigger;
}): Promise<SendEmailResult> {
  const { shop, invoiceId, templateId, trigger } = options;
  const settings = await getDeliverySettings(shop);
  if (!settings) return { ok: false, error: "Store not found" };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: "Invoice not found" };

  const buyer = readBuyer(invoice.buyer);
  const to = (options.to || buyer.email || "").trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "Customer email is missing" };
  }

  if (trigger === "auto" && (await hasEmailSentEvent(invoice.id, "tax_invoice"))) {
    return { ok: true, to, skipped: true };
  }

  const rendered = await renderInvoiceDocumentPdf(shop, invoiceId, templateId);
  if (!rendered) return { ok: false, error: "Failed to render invoice" };

  let invoiceLink = "";
  try {
    const link = await documentLinkResolver({
      shopDomain: shop,
      documentType: "tax_invoice",
      invoiceId: invoice.id,
    });
    invoiceLink = link || "";
  } catch (error) {
    console.warn("[email] invoice public link issue failed:", error);
  }

  const vars = {
    invoice_number: invoice.invoiceNumber,
    order_number: invoice.shopifyOrderNumber || invoice.invoiceNumber,
    shop_name: settings.fromName || shop,
    customer_name: buyer.name || "Customer",
    credit_note_number: "",
    invoice_link: invoiceLink,
    credit_note_link: "",
    refund_link: "",
    document_link: invoiceLink,
  };

  const subject = applyPlaceholders(settings.invoiceSubject, vars);
  const fields = emailFieldsForKind(settings, "invoice");
  const emailBodies = await composeEmailBodies({
    shop,
    settings,
    documentKind: "invoice",
    bodyMode: fields.bodyMode,
    designedBody: applyPlaceholders(
      normalizeEmailBodyContent(fields.designedTemplate),
      vars,
    ),
    customBody: applyPlaceholders(fields.customTemplate, vars),
    documentLink: invoiceLink,
  });
  const filename = pdfFilename(invoice.invoiceNumber);
  const metadata = {
    to,
    templateId: rendered.doc.templateId,
    documentType: "tax_invoice" as const,
    trigger,
  };
  const source = eventSourceForTrigger(trigger);

  try {
    const sent = await deliverViaResend({
      to,
      cc: parseCcList(settings.ccStaff),
      fromName: settings.fromName,
      replyTo: settings.replyTo,
      subject,
      text: emailBodies.text,
      html: emailBodies.html,
      filename,
      pdf: rendered.pdf,
    });

    if (!sent.ok) {
      await recordEmailEvent({
        invoiceId: invoice.id,
        status: "email_failed",
        message: `Invoice email failed: ${sent.error}`,
        metadata: { ...metadata, error: sent.error },
        source,
      });
      return { ok: false, error: sent.error, to };
    }

    await recordEmailEvent({
      invoiceId: invoice.id,
      status: "email_sent",
      message: `Invoice emailed to ${to}`,
      metadata: {
        ...metadata,
        providerId: sent.id,
        invoiceLink,
        from: sent.from,
        lastEvent: sent.lastEvent,
      },
      source,
    });
    return {
      ok: true,
      to,
      providerId: sent.id,
      from: sent.from,
      lastEvent: sent.lastEvent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    await recordEmailEvent({
      invoiceId: invoice.id,
      status: "email_failed",
      message: `Invoice email failed: ${message}`,
      metadata: { ...metadata, error: message },
      source,
    });
    return { ok: false, error: message, to };
  }
}

async function sendCreditNoteDerivedEmail(options: {
  shop: string;
  creditNoteId: string;
  documentType: "credit_note" | "refund_document";
  templateId?: string;
  to?: string;
  trigger: EmailTrigger;
}): Promise<SendEmailResult> {
  const { shop, creditNoteId, documentType, templateId, trigger } = options;
  const settings = await getDeliverySettings(shop);
  if (!settings) return { ok: false, error: "Store not found" };

  const creditNote = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
  });
  if (!creditNote) return { ok: false, error: "Credit note not found" };

  const buyer = readBuyer(creditNote.buyer);
  const to = (options.to || buyer.email || "").trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "Customer email is missing" };
  }

  if (
    trigger === "auto" &&
    (await hasEmailSentEvent(
      creditNote.invoiceId,
      documentType,
      creditNote.id,
    ))
  ) {
    return { ok: true, to, skipped: true };
  }

  const rendered =
    documentType === "refund_document"
      ? await renderRefundDocumentPdf(shop, creditNoteId, templateId)
      : await renderCreditNoteDocumentPdf(shop, creditNoteId, templateId);
  if (!rendered) return { ok: false, error: "Failed to render document" };

  const label =
    documentType === "refund_document"
      ? `Refund-${creditNote.creditNoteNumber}`
      : creditNote.creditNoteNumber;

  let documentLink = "";
  try {
    const link = await documentLinkResolver({
      shopDomain: shop,
      documentType,
      invoiceId: creditNote.invoiceId,
      creditNoteId: creditNote.id,
    });
    documentLink = link || "";
  } catch (error) {
    console.warn(`[email] ${documentType} public link issue failed:`, error);
  }

  const vars = {
    invoice_number: "",
    credit_note_number: creditNote.creditNoteNumber,
    order_number: rendered.doc.orderNumber || creditNote.creditNoteNumber,
    shop_name: settings.fromName || shop,
    customer_name: buyer.name || "Customer",
    invoice_link: "",
    credit_note_link: documentType === "credit_note" ? documentLink : "",
    refund_link: documentType === "refund_document" ? documentLink : "",
    document_link: documentLink,
  };

  const documentKind: EmailDocumentKind =
    documentType === "refund_document" ? "refund" : "credit_note";
  const fields = emailFieldsForKind(settings, documentKind);
  const subject = applyPlaceholders(fields.subjectTemplate, vars);
  const emailBodies = await composeEmailBodies({
    shop,
    settings,
    documentKind,
    bodyMode: fields.bodyMode,
    designedBody: applyPlaceholders(
      normalizeEmailBodyContent(fields.designedTemplate),
      vars,
    ),
    customBody: applyPlaceholders(fields.customTemplate, vars),
    documentLink,
  });
  const filename = pdfFilename(label);
  const metadata = {
    to,
    templateId: rendered.doc.templateId,
    documentType,
    trigger,
  };
  const source = eventSourceForTrigger(trigger);

  try {
    const sent = await deliverViaResend({
      to,
      cc: parseCcList(settings.ccStaff),
      fromName: settings.fromName,
      replyTo: settings.replyTo,
      subject,
      text: emailBodies.text,
      html: emailBodies.html,
      filename,
      pdf: rendered.pdf,
    });

    if (!sent.ok) {
      await recordEmailEvent({
        invoiceId: creditNote.invoiceId,
        creditNoteId: creditNote.id,
        status: "email_failed",
        message: `${documentType} email failed: ${sent.error}`,
        metadata: { ...metadata, error: sent.error },
        source,
      });
      return { ok: false, error: sent.error, to };
    }

    await recordEmailEvent({
      invoiceId: creditNote.invoiceId,
      creditNoteId: creditNote.id,
      status: "email_sent",
      message: `${documentType === "refund_document" ? "Refund document" : "Credit note"} emailed to ${to}`,
      metadata: {
        ...metadata,
        providerId: sent.id,
        documentLink,
        from: sent.from,
        lastEvent: sent.lastEvent,
      },
      source,
    });
    return {
      ok: true,
      to,
      providerId: sent.id,
      from: sent.from,
      lastEvent: sent.lastEvent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    await recordEmailEvent({
      invoiceId: creditNote.invoiceId,
      creditNoteId: creditNote.id,
      status: "email_failed",
      message: `${documentType} email failed: ${message}`,
      metadata: { ...metadata, error: message },
      source,
    });
    return { ok: false, error: message, to };
  }
}

export async function sendCreditNoteEmail(options: {
  shop: string;
  creditNoteId: string;
  templateId?: string;
  to?: string;
  trigger: EmailTrigger;
}): Promise<SendEmailResult> {
  return sendCreditNoteDerivedEmail({ ...options, documentType: "credit_note" });
}

export async function sendRefundDocumentEmail(options: {
  shop: string;
  creditNoteId: string;
  templateId?: string;
  to?: string;
  trigger: EmailTrigger;
}): Promise<SendEmailResult> {
  return sendCreditNoteDerivedEmail({
    ...options,
    documentType: "refund_document",
  });
}

/**
 * Unified entry for the three supported document types.
 * Packing slips are not supported.
 */
export async function sendDocumentEmail(options: {
  shop: string;
  documentType: DocumentEmailType;
  invoiceId?: string;
  creditNoteId?: string;
  templateId?: string;
  to?: string;
  trigger: EmailTrigger;
}): Promise<SendEmailResult> {
  if (options.documentType === "tax_invoice") {
    const invoiceId = options.invoiceId?.trim();
    if (!invoiceId) return { ok: false, error: "Invoice not found" };
    return sendInvoiceEmail({
      shop: options.shop,
      invoiceId,
      templateId: options.templateId,
      to: options.to,
      trigger: options.trigger,
    });
  }
  if (options.documentType === "credit_note") {
    const creditNoteId = options.creditNoteId?.trim();
    if (!creditNoteId) return { ok: false, error: "Credit note not found" };
    return sendCreditNoteEmail({
      shop: options.shop,
      creditNoteId,
      templateId: options.templateId,
      to: options.to,
      trigger: options.trigger,
    });
  }
  if (options.documentType === "refund_document") {
    const creditNoteId = options.creditNoteId?.trim();
    if (!creditNoteId) return { ok: false, error: "Credit note not found" };
    return sendRefundDocumentEmail({
      shop: options.shop,
      creditNoteId,
      templateId: options.templateId,
      to: options.to,
      trigger: options.trigger,
    });
  }
  return { ok: false, error: "Unsupported document type for email" };
}
