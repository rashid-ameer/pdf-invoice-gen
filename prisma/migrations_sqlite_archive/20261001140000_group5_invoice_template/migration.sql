-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "htmlPath" TEXT,
    "previewUrl" TEXT,
    "storeId" TEXT,
    "merchantId" TEXT,
    "baseLayoutCode" TEXT NOT NULL DEFAULT 'modern',
    "documentType" TEXT NOT NULL DEFAULT 'tax_invoice',
    "config" JSONB,
    "sourceType" TEXT NOT NULL DEFAULT 'layout',
    "customHtml" TEXT,
    "customCss" TEXT,
    "importMeta" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvoiceTemplate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvoiceTemplate_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InvoiceTemplate_storeId_idx" ON "InvoiceTemplate"("storeId");

-- CreateIndex
CREATE INDEX "InvoiceTemplate_merchantId_idx" ON "InvoiceTemplate"("merchantId");

-- CreateIndex
CREATE INDEX "InvoiceTemplate_code_isSystem_idx" ON "InvoiceTemplate"("code", "isSystem");

-- CreateIndex
CREATE INDEX "InvoiceTemplate_isSystem_isActive_idx" ON "InvoiceTemplate"("isSystem", "isActive");

-- CreateIndex
CREATE INDEX "InvoiceTemplate_documentType_isSystem_isActive_idx" ON "InvoiceTemplate"("documentType", "isSystem", "isActive");

-- Partial unique: one system template per code (matches old Mongo partial unique on isSystem:true)
CREATE UNIQUE INDEX "InvoiceTemplate_system_code_key" ON "InvoiceTemplate"("code") WHERE "isSystem" = 1;

-- Partial unique: one custom template code per store (matches old sparse unique on storeId+code)
CREATE UNIQUE INDEX "InvoiceTemplate_storeId_code_key" ON "InvoiceTemplate"("storeId", "code") WHERE "storeId" IS NOT NULL;
