-- Group 11 Phase 1: expand CreditNote stub to full refund-linked document fields.
-- Stub rows were count-only (id/storeId/timestamps) and cannot map to invoices — drop them.

PRAGMA foreign_keys=OFF;

DELETE FROM "CreditNote";

DROP TABLE "CreditNote";

CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "reason" TEXT,
    "issueDate" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "lineItems" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditNote_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CreditNote_storeId_shopifyRefundId_key" ON "CreditNote"("storeId", "shopifyRefundId");
CREATE UNIQUE INDEX "CreditNote_storeId_creditNoteNumber_key" ON "CreditNote"("storeId", "creditNoteNumber");
CREATE INDEX "CreditNote_storeId_idx" ON "CreditNote"("storeId");
CREATE INDEX "CreditNote_merchantId_idx" ON "CreditNote"("merchantId");
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");
CREATE INDEX "CreditNote_storeId_createdAt_idx" ON "CreditNote"("storeId", "createdAt");

PRAGMA foreign_keys=ON;
