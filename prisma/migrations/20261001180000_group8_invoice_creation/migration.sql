-- Group 8: expand Invoice + add InvoiceStatusEvent
-- Recreate Invoice (stub had only id/storeId/timestamps)

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderNumber" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'generated',
    "financialStatus" TEXT,
    "issueDate" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "shippingAddress" JSONB,
    "shippingMethod" TEXT,
    "orderNote" TEXT,
    "lineItems" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "pint" JSONB,
    "pdfUrl" TEXT,
    "defaultTemplateId" TEXT,
    "aspExternalId" TEXT,
    "aspPayloadRef" TEXT,
    "aspStatus" TEXT,
    "validationErrors" JSONB,
    "publicAccess" JSONB,
    "verification" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invoice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Migrate any stub rows into placeholders (dev DBs only; production stubs are empty)
INSERT INTO "new_Invoice" (
  "id", "merchantId", "storeId", "legalEntityId", "shopifyOrderId", "invoiceNumber",
  "issueDate", "seller", "buyer", "lineItems", "totals", "createdAt", "updatedAt"
)
SELECT
  i."id",
  s."merchantId",
  i."storeId",
  s."merchantId",
  'stub-' || i."id",
  'STUB-' || i."id",
  i."createdAt",
  json('{"legalName":"stub","address":{"line1":"","city":"","country":""}}'),
  json('{"name":"stub"}'),
  json('[]'),
  json('{"subtotal":0,"discount":0,"vatTotal":0,"shipping":0,"grandTotal":0}'),
  i."createdAt",
  i."updatedAt"
FROM "Invoice" i
INNER JOIN "Store" s ON s."id" = i."storeId";

DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";

CREATE UNIQUE INDEX "Invoice_storeId_shopifyOrderId_key" ON "Invoice"("storeId", "shopifyOrderId");
CREATE UNIQUE INDEX "Invoice_legalEntityId_invoiceNumber_key" ON "Invoice"("legalEntityId", "invoiceNumber");
CREATE INDEX "Invoice_storeId_idx" ON "Invoice"("storeId");
CREATE INDEX "Invoice_merchantId_status_createdAt_idx" ON "Invoice"("merchantId", "status", "createdAt");
CREATE INDEX "Invoice_storeId_createdAt_idx" ON "Invoice"("storeId", "createdAt");
CREATE INDEX "Invoice_storeId_issueDate_idx" ON "Invoice"("storeId", "issueDate");
CREATE INDEX "Invoice_storeId_status_idx" ON "Invoice"("storeId", "status");

CREATE TABLE "InvoiceStatusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "creditNoteId" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'system',
    "message" TEXT,
    "metadata" JSONB,
    "payloadRef" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvoiceStatusEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "InvoiceStatusEvent_invoiceId_occurredAt_idx" ON "InvoiceStatusEvent"("invoiceId", "occurredAt");

PRAGMA foreign_keys=ON;
