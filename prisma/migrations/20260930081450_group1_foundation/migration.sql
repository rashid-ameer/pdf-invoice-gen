-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "billingStatus" TEXT NOT NULL DEFAULT 'trial',
    "planId" TEXT,
    "ownerUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "shopifyStoreId" TEXT,
    "accessToken" TEXT NOT NULL,
    "accessTokenRef" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "defaultLegalEntityId" TEXT,
    "aspConnectionId" TEXT,
    "defaultTemplateId" TEXT,
    "defaultPackingSlipTemplateId" TEXT,
    "defaultCreditNoteTemplateId" TEXT,
    "defaultRefundDocumentTemplateId" TEXT,
    "invoiceMode" TEXT NOT NULL DEFAULT 'standard',
    "complianceReady" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Store_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "trn" TEXT,
    "tin" TEXT,
    "tradeLicence" TEXT,
    "vatStatus" TEXT NOT NULL DEFAULT 'registered',
    "businessEmail" TEXT NOT NULL,
    "businessPhone" TEXT,
    "address" JSONB NOT NULL,
    "emirate" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LegalEntity_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaxIdentifier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legalEntityId" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "verifiedStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaxIdentifier_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT,
    "storeId" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Setting_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Setting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopBranding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#1a1a2e',
    "secondaryColor" TEXT NOT NULL DEFAULT '#16213e',
    "accentColor" TEXT NOT NULL DEFAULT '#0f3460',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "footerText" TEXT NOT NULL DEFAULT '',
    "socialLinks" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopBranding" ("accentColor", "createdAt", "footerText", "id", "logoUrl", "primaryColor", "secondaryColor", "shop", "socialLinks", "updatedAt") SELECT "accentColor", "createdAt", "footerText", "id", "logoUrl", "primaryColor", "secondaryColor", "shop", '{"showOnInvoice":false}', "updatedAt" FROM "ShopBranding";
DROP TABLE "ShopBranding";
ALTER TABLE "new_ShopBranding" RENAME TO "ShopBranding";
CREATE UNIQUE INDEX "ShopBranding_shop_key" ON "ShopBranding"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopifyDomain_key" ON "Store"("shopifyDomain");

-- CreateIndex
CREATE INDEX "Store_merchantId_idx" ON "Store"("merchantId");

-- CreateIndex
CREATE INDEX "LegalEntity_merchantId_idx" ON "LegalEntity"("merchantId");

-- CreateIndex
CREATE INDEX "TaxIdentifier_legalEntityId_idx" ON "TaxIdentifier"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxIdentifier_legalEntityId_identifierType_key" ON "TaxIdentifier"("legalEntityId", "identifierType");

-- CreateIndex
CREATE INDEX "Setting_merchantId_idx" ON "Setting"("merchantId");

-- CreateIndex
CREATE INDEX "Setting_storeId_idx" ON "Setting"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_merchantId_storeId_key_key" ON "Setting"("merchantId", "storeId", "key");

-- CreateIndex
CREATE INDEX "Invoice_storeId_idx" ON "Invoice"("storeId");

-- CreateIndex
CREATE INDEX "CreditNote_storeId_idx" ON "CreditNote"("storeId");
