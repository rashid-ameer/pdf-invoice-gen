/**
 * Audit shops where the legacy master delivery flag is off, but at least one
 * per-document auto-send setting is on.
 *
 * After removing the master gate from auto-send decisions, these shops would
 * start sending automated emails for the document types they already enabled.
 *
 * DO NOT run against production without review. This script only READS data;
 * it does not update any settings.
 *
 * Run from pdf-invoice-gen (uses DATABASE_URL / Prisma from .env):
 *
 *   npx tsx scripts/audit-master-disabled-autosend.ts
 */

import prisma from "../app/db.server";

type DeliveryValue = {
  enabled?: unknown;
  invoiceAutoSend?: unknown;
  creditNoteAutoSend?: unknown;
  refundDocumentAutoSend?: unknown;
};

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === "on") return true;
  if (value === "false" || value === "0" || value === "off") return false;
  return false;
}

async function main() {
  const rows = await prisma.setting.findMany({
    where: { key: "delivery_settings" },
    include: {
      store: { select: { id: true, shopifyDomain: true, status: true } },
    },
  });

  const affected: Array<{
    shop: string;
    storeId: string;
    status: string;
    invoiceAutoSend: boolean;
    creditNoteAutoSend: boolean;
    refundDocumentAutoSend: boolean;
  }> = [];

  for (const row of rows) {
    const value = (row.value ?? {}) as DeliveryValue;
    const masterEnabled = asBool(value.enabled);
    const invoiceAutoSend = asBool(value.invoiceAutoSend);
    const creditNoteAutoSend = asBool(value.creditNoteAutoSend);
    const refundDocumentAutoSend = asBool(value.refundDocumentAutoSend);

    if (masterEnabled) continue;
    if (!invoiceAutoSend && !creditNoteAutoSend && !refundDocumentAutoSend) {
      continue;
    }

    affected.push({
      shop: row.store.shopifyDomain,
      storeId: row.store.id,
      status: row.store.status,
      invoiceAutoSend,
      creditNoteAutoSend,
      refundDocumentAutoSend,
    });
  }

  console.log(
    `Found ${affected.length} shop(s) with master enabled=false and at least one document auto-send=true:\n`,
  );
  for (const row of affected) {
    console.log(
      JSON.stringify({
        shop: row.shop,
        storeId: row.storeId,
        status: row.status,
        invoiceAutoSend: row.invoiceAutoSend,
        creditNoteAutoSend: row.creditNoteAutoSend,
        refundDocumentAutoSend: row.refundDocumentAutoSend,
      }),
    );
  }

  if (affected.length === 0) {
    console.log("(none)");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
