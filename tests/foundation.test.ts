import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  nextCreditNoteNumber,
  nextInvoiceNumber,
} from "../app/models/document-number.server";
import {
  buildFallbackSellerSnapshot,
  buildSellerSnapshot,
} from "../app/models/seller-snapshot.server";
import { formatAmount, formatDiscountPercent } from "../app/utils/money-format";
import { dubaiDayBounds } from "../app/utils/date-bounds";
import { encryptSecret, decryptSecret } from "../app/utils/token-crypto";
import {
  parseDocumentPage,
  parseDocumentPageSize,
  DOCUMENT_PAGE_SIZE,
} from "../app/utils/list-pagination";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.creditNote.deleteMany({ where: { storeId: row.storeId } });
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    await prisma.setting.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedStore() {
  const merchant = await prisma.merchant.create({
    data: { name: `merchant-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `store-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("test-token")!,
      invoiceMode: "standard",
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  return { merchant, store };
}

describe("money formatters", () => {
  it("formats amounts to two decimals", () => {
    assert.equal(formatAmount(12.5), "12.50");
    assert.equal(formatAmount(0), "0.00");
  });

  it("formats discount percent like the old service", () => {
    assert.equal(formatDiscountPercent(0, 2, 10), "0%");
    assert.equal(formatDiscountPercent(5, 2, 10), "25%");
    assert.equal(formatDiscountPercent(1, 3, 10), "3.33%");
  });
});

describe("pagination and dubai day bounds", () => {
  it("parses page and page size with old defaults", () => {
    assert.equal(parseDocumentPage("0"), 1);
    assert.equal(parseDocumentPage("3"), 3);
    assert.equal(parseDocumentPageSize("20"), 20);
    assert.equal(parseDocumentPageSize("15"), DOCUMENT_PAGE_SIZE);
  });

  it("builds dubai (+04:00) day bounds", () => {
    const range = dubaiDayBounds("2024-01-01", "2024-01-02");
    assert.ok(range?.gte);
    assert.ok(range?.lte);
    assert.equal(range!.gte!.toISOString(), "2023-12-31T20:00:00.000Z");
    assert.equal(range!.lte!.toISOString(), "2024-01-02T19:59:59.999Z");
  });
});

describe("token crypto", () => {
  it("encrypts and decrypts secrets", () => {
    const encrypted = encryptSecret("plain-token")!;
    assert.ok(encrypted.startsWith("enc:v1:"));
    assert.equal(decryptSecret(encrypted), "plain-token");
    assert.equal(encryptSecret(encrypted), encrypted);
  });
});

describe("seller snapshot", () => {
  it("maps legal entity fields and normalizes address", () => {
    const seller = buildSellerSnapshot({
      legalName: "Acme LLC",
      tradeName: "Acme",
      trn: "100000000000003",
      tin: "1000000000",
      businessEmail: "a@example.com",
      address: {
        line1: "  Street 1 ",
        city: " Dubai ",
        emirate: "Dubai",
        country: "AE",
      },
      emirate: "Dubai",
    });
    assert.equal(seller.legalName, "Acme LLC");
    assert.equal(seller.taxSchemeCode, "VAT");
    assert.equal(seller.address.line1, "Street 1");
    assert.equal(seller.address.city, "Dubai");
    assert.equal(seller.emirate, "Dubai");
  });

  it("uses the old no-legal-entity fallback", () => {
    const seller = buildFallbackSellerSnapshot("demo.myshopify.com", "AED");
    assert.equal(seller.legalName, "demo.myshopify.com");
    assert.equal(seller.address.line1, "demo.myshopify.com");
    assert.equal(seller.address.country, "AE");
  });
});

describe("document numbering", () => {
  it("uses INV-/CN- defaults and count + 1", async () => {
    const { merchant, store } = await seedStore();
    assert.equal(await nextInvoiceNumber(store.id, merchant.id), "INV-00001");
    assert.equal(await nextCreditNoteNumber(store.id, merchant.id), "CN-00001");

    await prisma.invoice.create({ data: { storeId: store.id } });
    await prisma.creditNote.create({ data: { storeId: store.id } });

    assert.equal(await nextInvoiceNumber(store.id, merchant.id), "INV-00002");
    assert.equal(await nextCreditNoteNumber(store.id, merchant.id), "CN-00002");
  });

  it("reads store prefix settings when present", async () => {
    const { merchant, store } = await seedStore();
    await prisma.setting.create({
      data: {
        merchantId: merchant.id,
        storeId: store.id,
        scope: "store",
        key: "invoice_prefix",
        value: "TAX-",
      },
    });
    assert.equal(await nextInvoiceNumber(store.id, merchant.id), "TAX-00001");
  });
});
