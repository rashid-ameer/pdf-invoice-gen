/**
 * Group 17 Phase 2 — GDPR / privacy handlers (old privacy.service.ts parity).
 *
 * Deviations (models absent in Prisma — no new product models added):
 * - WebhookEvent: not persisted (old wrote processed GDPR events; shop redact deleted them).
 * - Customer / BuyerProfile: customers/redact skips those deletes (models do not exist).
 * - User / AuditLog / Subscription: shop/redact last-store cleanup skips these (absent).
 * - StoreBranding → ShopBranding keyed by shop domain (not storeId).
 */

import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { APP_NAME } from "../constants/app";
import prisma from "../db.server";
import { deleteSessionsByShop } from "./install.server";
import { getResendConfig } from "./resend.server";

type DataRequestPayload = {
  shop_id?: number;
  shop_domain?: string;
  orders_requested?: Array<number | string>;
  customer?: { id?: number | string; email?: string; phone?: string };
  data_request?: { id?: number };
};

type CustomerRedactPayload = {
  shop_id?: number;
  shop_domain?: string;
  customer?: { id?: number | string; email?: string; phone?: string };
  orders_to_redact?: Array<number | string>;
};

type BuyerSnapshot = {
  name?: string;
  legalName?: string;
  trn?: string;
  tin?: string;
  email?: string;
  phone?: string;
  address?: unknown;
  [key: string]: unknown;
};

type TotalsSnapshot = {
  grandTotal?: number;
  [key: string]: unknown;
};

function parseJson<T>(rawBody: string): T {
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    return {} as T;
  }
}

function asPayload<T>(rawBody: string | unknown): T {
  if (typeof rawBody === "string") return parseJson<T>(rawBody);
  if (rawBody && typeof rawBody === "object") return rawBody as T;
  return {} as T;
}

/** Old redactedBuyer() — address omitted (undefined) like Mongo $set. */
export function redactedBuyer() {
  return {
    name: "Redacted customer",
    legalName: "",
    trn: "",
    tin: "",
    email: "",
    phone: "",
  };
}

function buyerEmailMatches(buyer: unknown, emailLower: string): boolean {
  if (!emailLower) return false;
  const value =
    buyer && typeof buyer === "object" && "email" in buyer
      ? (buyer as BuyerSnapshot).email
      : undefined;
  return typeof value === "string" && value.trim().toLowerCase() === emailLower;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive exact email match (old RegExp `^…$` with `i` flag).
 * Used when redact keeps the original casing in the pattern.
 */
function buyerEmailMatchesInsensitive(buyer: unknown, email: string): boolean {
  if (!email) return false;
  const value =
    buyer && typeof buyer === "object" && "email" in buyer
      ? (buyer as BuyerSnapshot).email
      : undefined;
  if (typeof value !== "string") return false;
  return new RegExp(`^${escapeRegExp(email)}$`, "i").test(value.trim());
}

async function findStore(shopDomain: string) {
  return prisma.store.findUnique({ where: { shopifyDomain: shopDomain } });
}

type DataRequestEmailInput = {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
};

async function sendDataRequestEmailDefault(input: DataRequestEmailInput) {
  const resend = new Resend(input.apiKey);
  await resend.emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
}

let sendDataRequestEmailImpl = sendDataRequestEmailDefault;

/** Test hook — restores default Resend send when passed null. */
export function setPrivacyDataRequestEmailForTests(
  fn: ((input: DataRequestEmailInput) => Promise<void>) | null,
) {
  sendDataRequestEmailImpl = fn ?? sendDataRequestEmailDefault;
}

function grandTotalOf(totals: unknown): number | undefined {
  if (!totals || typeof totals !== "object") return undefined;
  const g = (totals as TotalsSnapshot).grandTotal;
  return typeof g === "number" ? g : undefined;
}

export async function handleCustomersDataRequest(
  shopDomain: string,
  rawBody: string | unknown,
) {
  const payload = asPayload<DataRequestPayload>(rawBody);
  const store = await findStore(shopDomain);
  const orderIds = (payload.orders_requested ?? []).map((id) => String(id));
  const email = payload.customer?.email?.trim().toLowerCase() ?? "";

  let invoices: Array<{
    invoiceNumber: string;
    shopifyOrderId: string;
    shopifyOrderNumber: string | null;
    buyer: unknown;
    issueDate: Date;
    currency: string;
    totals: unknown;
  }> = [];
  let creditNotes: Array<{
    creditNoteNumber: string;
    shopifyOrderId: string;
    shopifyRefundId: string;
    buyer: unknown;
    issueDate: Date;
    currency: string;
    totals: unknown;
  }> = [];

  if (store) {
    const allInvoices = await prisma.invoice.findMany({
      where: { storeId: store.id },
      select: {
        invoiceNumber: true,
        shopifyOrderId: true,
        shopifyOrderNumber: true,
        buyer: true,
        issueDate: true,
        currency: true,
        totals: true,
      },
    });

    // Old invoiceQuery: storeId only when neither orderIds nor email — exports ALL invoices.
    invoices = allInvoices.filter((invoice) => {
      if (orderIds.length && email) {
        return (
          orderIds.includes(invoice.shopifyOrderId) ||
          buyerEmailMatches(invoice.buyer, email)
        );
      }
      if (orderIds.length) return orderIds.includes(invoice.shopifyOrderId);
      if (email) return buyerEmailMatches(invoice.buyer, email);
      return true;
    });

    // Old CreditNote $or: empty array when both filters missing → no matches (preserve).
    if (orderIds.length || email) {
      const allNotes = await prisma.creditNote.findMany({
        where: { storeId: store.id },
        select: {
          creditNoteNumber: true,
          shopifyOrderId: true,
          shopifyRefundId: true,
          buyer: true,
          issueDate: true,
          currency: true,
          totals: true,
        },
      });
      creditNotes = allNotes.filter((note) => {
        const byOrder =
          orderIds.length > 0 && orderIds.includes(note.shopifyOrderId);
        const byEmail = email ? buyerEmailMatches(note.buyer, email) : false;
        return byOrder || byEmail;
      });
    }
  }

  const exportPayload = {
    shop: shopDomain,
    customer: payload.customer ?? {},
    dataRequestId: payload.data_request?.id ?? null,
    invoices: invoices.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      orderId: invoice.shopifyOrderId,
      orderNumber: invoice.shopifyOrderNumber,
      issueDate: invoice.issueDate,
      currency: invoice.currency,
      grandTotal: grandTotalOf(invoice.totals),
      buyer: invoice.buyer,
    })),
    creditNotes: creditNotes.map((note) => ({
      creditNoteNumber: note.creditNoteNumber,
      orderId: note.shopifyOrderId,
      refundId: note.shopifyRefundId,
      issueDate: note.issueDate,
      currency: note.currency,
      grandTotal: grandTotalOf(note.totals),
      buyer: note.buyer,
    })),
  };

  // Old persisted WebhookEvent here — skipped (no WebhookEvent model).

  const { apiKey, from } = getResendConfig();
  if (apiKey && store) {
    const legalEntity = store.defaultLegalEntityId
      ? await prisma.legalEntity.findUnique({
          where: { id: store.defaultLegalEntityId },
        })
      : await prisma.legalEntity.findFirst({
          where: { merchantId: store.merchantId },
        });
    const to = legalEntity?.businessEmail;
    if (to) {
      try {
        await sendDataRequestEmailImpl({
          apiKey,
          from: from || `${APP_NAME} <noreply@resend.dev>`,
          to,
          subject: `${APP_NAME} customer data request`,
          text: `A customer requested a copy of their data stored in ${APP_NAME}.\n\n${JSON.stringify(exportPayload, null, 2)}`,
        });
      } catch (error) {
        console.warn("[privacy] failed to email data request export:", error);
      }
    }
  }

  console.log(
    `[privacy] customers/data_request for ${shopDomain}: ${invoices.length} invoices, ${creditNotes.length} credit notes`,
  );

  return exportPayload;
}

export async function handleCustomersRedact(
  shopDomain: string,
  rawBody: string | unknown,
) {
  const payload = asPayload<CustomerRedactPayload>(rawBody);
  const store = await findStore(shopDomain);
  if (!store) {
    console.warn(`[privacy] customers/redact store not found: ${shopDomain}`);
    return;
  }

  const orderIds = (payload.orders_to_redact ?? []).map((id) => String(id));
  const email = payload.customer?.email?.trim() ?? "";
  // customerId used only for Customer/BuyerProfile deletes in old app — models absent.

  const allInvoices = await prisma.invoice.findMany({
    where: { storeId: store.id },
    select: {
      id: true,
      shopifyOrderId: true,
      buyer: true,
    },
  });

  /**
   * Old empty-$or edge case: when both order IDs and email are missing, `or` stays
   * empty and the filter is only `{ storeId }` — every store invoice/CN is redacted.
   * Preserve that behavior.
   */
  const matchAll = orderIds.length === 0 && !email;
  const invoiceIds = allInvoices
    .filter((invoice) => {
      if (matchAll) return true;
      if (orderIds.includes(invoice.shopifyOrderId)) return true;
      if (email && buyerEmailMatchesInsensitive(invoice.buyer, email)) {
        return true;
      }
      return false;
    })
    .map((row) => row.id);

  if (invoiceIds.length) {
    await prisma.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: {
        buyer: redactedBuyer(),
        shippingAddress: Prisma.DbNull,
        publicAccess: Prisma.DbNull,
      },
    });
  }

  const allNotes = await prisma.creditNote.findMany({
    where: { storeId: store.id },
    select: {
      id: true,
      shopifyOrderId: true,
      buyer: true,
    },
  });
  const creditNoteIds = allNotes
    .filter((note) => {
      if (matchAll) return true;
      if (orderIds.includes(note.shopifyOrderId)) return true;
      if (email && buyerEmailMatchesInsensitive(note.buyer, email)) return true;
      return false;
    })
    .map((row) => row.id);

  if (creditNoteIds.length) {
    await prisma.creditNote.updateMany({
      where: { id: { in: creditNoteIds } },
      data: {
        buyer: redactedBuyer(),
        publicAccessCreditNote: Prisma.DbNull,
        publicAccessRefundDocument: Prisma.DbNull,
      },
    });
  }

  // Old: Customer + BuyerProfile delete by shopifyCustomerId — skipped (no models).
  // Old: WebhookEvent upsert — skipped (no WebhookEvent model).

  console.log(
    `[privacy] customers/redact for ${shopDomain}: anonymized ${invoiceIds.length} invoices`,
  );
}

export async function handleShopRedact(shopDomain: string) {
  const store = await findStore(shopDomain);
  await deleteSessionsByShop(shopDomain);

  if (!store) {
    console.log(`[privacy] shop/redact: no store record for ${shopDomain}`);
    return;
  }

  const storeId = store.id;
  const merchantId = store.merchantId;

  const invoices = await prisma.invoice.findMany({
    where: { storeId },
    select: { id: true },
  });
  const invoiceIds = invoices.map((row) => row.id);
  const creditNotes = await prisma.creditNote.findMany({
    where: { storeId },
    select: { id: true },
  });
  const creditNoteIds = creditNotes.map((row) => row.id);

  if (invoiceIds.length || creditNoteIds.length) {
    await prisma.invoiceStatusEvent.deleteMany({
      where: {
        OR: [
          ...(invoiceIds.length
            ? [{ invoiceId: { in: invoiceIds } }]
            : []),
          ...(creditNoteIds.length
            ? [{ creditNoteId: { in: creditNoteIds } }]
            : []),
        ],
      },
    });
  }
  // Delete credit notes before invoices (CN → Invoice FK).
  await prisma.creditNote.deleteMany({ where: { storeId } });
  await prisma.invoice.deleteMany({ where: { storeId } });
  // Old StoreBranding.deleteOne({ storeId }) → ShopBranding by shop domain.
  await prisma.shopBranding.deleteMany({ where: { shop: shopDomain } });
  await prisma.invoiceTemplate.deleteMany({ where: { storeId } });
  // Old WebhookEvent.deleteMany({ storeId }) — skipped (no model).
  await prisma.setting.deleteMany({ where: { storeId } });

  const remainingStores = await prisma.store.count({
    where: {
      merchantId,
      id: { not: storeId },
    },
  });

  if (remainingStores === 0) {
    const legalEntities = await prisma.legalEntity.findMany({
      where: { merchantId },
      select: { id: true },
    });
    const legalEntityIds = legalEntities.map((row) => row.id);
    await prisma.taxIdentifier.deleteMany({
      where: { legalEntityId: { in: legalEntityIds } },
    });
    await prisma.aspConnection.deleteMany({
      where: { legalEntityId: { in: legalEntityIds } },
    });
    await prisma.legalEntity.deleteMany({ where: { merchantId } });

    // Old: Customer, BuyerProfile, User, AuditLog, Subscription — absent; skipped.
    await prisma.setting.deleteMany({ where: { merchantId } });
    await prisma.invoiceTemplate.deleteMany({
      where: { merchantId, storeId: null },
    });
    // Merchant → Store is onDelete: Cascade in Prisma (Mongo had no cascade).
    // Deleting the merchant removes this store; deleteMany keeps the step idempotent.
    await prisma.merchant.delete({ where: { id: merchantId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
  } else {
    await prisma.store.delete({ where: { id: storeId } });
  }

  console.log(`[privacy] shop/redact deleted data for ${shopDomain}`);
}
