import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../app/db.server";
import {
  exportAllInvoicesForShop,
  invoicesToCsv,
  listInvoicesForShop,
  parseInvoiceListQuery,
} from "../app/models/invoice-list.server";
import { csvDownloadResponse } from "../app/utils/document-response.server";
import { encryptSecret } from "../app/utils/token-crypto";

const cleanup: Array<{ merchantId: string; storeId: string }> = [];

after(async () => {
  for (const row of cleanup) {
    await prisma.invoice.deleteMany({ where: { storeId: row.storeId } });
    await prisma.store.deleteMany({ where: { id: row.storeId } });
    await prisma.merchant.deleteMany({ where: { id: row.merchantId } });
  }
  await prisma.$disconnect();
});

async function seedInvoice(opts?: {
  shippingMethod?: string;
  financialStatus?: string;
}) {
  const merchant = await prisma.merchant.create({
    data: { name: `m-${randomUUID()}`, billingStatus: "active" },
  });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopifyDomain: `ps-${randomUUID()}.myshopify.com`,
      accessToken: encryptSecret("tok")!,
      status: "active",
      currency: "AED",
    },
  });
  cleanup.push({ merchantId: merchant.id, storeId: store.id });
  const invoice = await prisma.invoice.create({
    data: {
      merchantId: merchant.id,
      storeId: store.id,
      legalEntityId: merchant.id,
      shopifyOrderId: String(Math.floor(Math.random() * 1e9)),
      shopifyOrderNumber: "#PS-1001",
      invoiceNumber: `INV-PS-${randomUUID().slice(0, 6)}`,
      status: "generated",
      financialStatus: opts?.financialStatus ?? "paid",
      shippingMethod: opts?.shippingMethod ?? "Standard Shipping",
      issueDate: new Date("2024-06-15T10:00:00Z"),
      currency: "AED",
      seller: { legalName: "Seller", address: { city: "Dubai", country: "AE" } },
      buyer: {
        name: "PS Buyer",
        email: "ps-buyer@example.com",
        phone: "+971500000099",
      },
      lineItems: [
        {
          description: "Item",
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          vatRate: 5,
          vatAmount: 0.5,
          lineTotal: 10.5,
        },
      ],
      totals: {
        subtotal: 10,
        discount: 0,
        vatTotal: 0.5,
        shipping: 0,
        grandTotal: 10.5,
      },
      mode: "standard",
    },
  });
  return { merchant, store, invoice };
}

describe("packing slips Phase 1 — list + CSV", () => {
  it("reuses invoice list data for packing slips page source", async () => {
    const { store, invoice } = await seedInvoice();
    const list = await listInvoicesForShop(store.shopifyDomain, {
      ...parseInvoiceListQuery({}),
    });
    assert.ok(list);
    assert.equal(list!.total, 1);
    assert.equal(list!.items[0]!.id, invoice.id);
    assert.equal(list!.items[0]!.shippingMethod, "Standard Shipping");
  });

  it("packing-slips CSV uses old column set (not invoice export columns)", async () => {
    const { store, invoice } = await seedInvoice({
      shippingMethod: "Express",
      financialStatus: "paid",
    });
    const exported = await exportAllInvoicesForShop(store.shopifyDomain);
    assert.ok(exported);
    const csv = invoicesToCsv(exported!.items, "packing-slips");
    const header = csv.split("\r\n")[0] ?? csv.split("\n")[0];
    assert.equal(
      header,
      "Order,Invoice,Customer,Email,Phone,Date,Payment status,Shipping method,Currency,Grand total",
    );
    assert.match(csv, /#PS-1001/);
    assert.match(csv, new RegExp(invoice.invoiceNumber));
    assert.match(csv, /PS Buyer/);
    assert.match(csv, /ps-buyer@example.com/);
    assert.match(csv, /Paid/);
    assert.match(csv, /Express/);
    assert.match(csv, /AED/);
    assert.match(csv, /10\.5/);
    assert.doesNotMatch(csv, /Document status/);
    assert.doesNotMatch(csv, /Subtotal/);
    assert.doesNotMatch(csv, /\bVAT\b/);
    assert.doesNotMatch(csv, /\bMode\b/);
  });

  it("default invoicesToCsv remains invoice columns", async () => {
    const { store } = await seedInvoice();
    const exported = await exportAllInvoicesForShop(store.shopifyDomain);
    const csv = invoicesToCsv(exported!.items);
    const header = csv.split("\r\n")[0] ?? csv.split("\n")[0];
    assert.match(header!, /^Invoice,Order,Customer/);
    assert.match(header!, /Document status/);
    assert.match(header!, /Subtotal/);
  });

  it("packing-slips CSV download response uses packing-slips filename prefix", () => {
    const response = csvDownloadResponse("a,b\r\n1,2\r\n", "packing-slips");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    assert.match(disposition, /filename="packing-slips-/);
    assert.match(disposition, /\.csv"/);
  });

  it("packing slips route module exists and invoices page module unchanged for list UI", () => {
    const packingSrc = readFileSync(
      join(process.cwd(), "app/routes/app.packing-slips.tsx"),
      "utf8",
    );
    assert.match(packingSrc, /heading="Packing slips"/);
    assert.match(packingSrc, /listInvoicesForShop/);
    assert.match(packingSrc, /\/app\/packing-slips\/export\/csv/);
    assert.match(packingSrc, /No packing slips yet/);
    assert.match(packingSrc, /No packing slips found/);
    // Same columns as Invoices: Invoice (linked) primary, then Order…
    assert.match(packingSrc, /<s-text>Invoice<\/s-text>/);
    assert.match(packingSrc, /listSlot="labeled">Order</);
    assert.match(packingSrc, /clickDelegate=\{linkId\}/);
    assert.match(packingSrc, /s-link id=\{linkId\} href=\{detailsHref\}/);
    // Phase 2/3: View opens details; Print / Download on list
    assert.match(packingSrc, /\/app\/packing-slips\/\$\{/);
    assert.match(packingSrc, /downloadPackingSlipPdf/);
    assert.match(packingSrc, /fetchAndPrintPackingSlipDocument/);
    assert.match(packingSrc, /fetchAndPrintPackingSlipDocuments/);
    assert.match(packingSrc, /Print selected/);
    assert.doesNotMatch(packingSrc, /Download selected/);
    assert.doesNotMatch(packingSrc, />\s*Copy\s*</);
    assert.doesNotMatch(packingSrc, />\s*Send email\s*</);

    const invoicesSrc = readFileSync(
      join(process.cwd(), "app/routes/app.invoices.tsx"),
      "utf8",
    );
    assert.match(invoicesSrc, /heading="Invoices"/);
    assert.match(invoicesSrc, /downloadInvoicePdf/);
    assert.match(invoicesSrc, /Print selected/);
  });

  it("nav includes Packing slips link", () => {
    const appSrc = readFileSync(
      join(process.cwd(), "app/routes/app.tsx"),
      "utf8",
    );
    assert.match(appSrc, /href="\/app\/packing-slips"/);
    assert.match(appSrc, /Packing slips/);
  });
});
