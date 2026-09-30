import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

async function getSettingValue(
  storeId: string,
  merchantId: string,
  key: string,
  fallback: string,
): Promise<string> {
  const storeSetting = await prisma.setting.findFirst({
    where: { storeId, key },
  });
  if (
    storeSetting &&
    typeof storeSetting.value === "string" &&
    storeSetting.value.trim()
  ) {
    return storeSetting.value.trim();
  }

  const merchantSetting = await prisma.setting.findFirst({
    where: { merchantId, key },
  });
  if (
    merchantSetting &&
    typeof merchantSetting.value === "string" &&
    merchantSetting.value.trim()
  ) {
    return merchantSetting.value.trim();
  }

  return fallback;
}

function formatDocumentNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(5, "0")}`;
}

export async function nextInvoiceNumber(
  storeId: string,
  merchantId: string,
): Promise<string> {
  const prefix = await getSettingValue(
    storeId,
    merchantId,
    "invoice_prefix",
    "INV-",
  );
  const count = await prisma.invoice.count({ where: { storeId } });
  return formatDocumentNumber(prefix, count + 1);
}

export async function nextCreditNoteNumber(
  storeId: string,
  merchantId: string,
): Promise<string> {
  const prefix = await getSettingValue(
    storeId,
    merchantId,
    "credit_note_prefix",
    "CN-",
  );
  const count = await prisma.creditNote.count({ where: { storeId } });
  return formatDocumentNumber(prefix, count + 1);
}

/** Helper for Group 2+ setting upserts; keeps value typing local. */
export type SettingValue = Prisma.InputJsonValue;
