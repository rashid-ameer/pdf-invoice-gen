-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopBranding" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#1a1a2e',
    "secondaryColor" TEXT NOT NULL DEFAULT '#16213e',
    "accentColor" TEXT NOT NULL DEFAULT '#0f3460',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "footerText" TEXT NOT NULL DEFAULT '',
    "socialLinks" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingStatus" TEXT NOT NULL DEFAULT 'trial',
    "planId" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "shopifyStoreId" TEXT,
    "accessToken" TEXT NOT NULL,
    "accessTokenRef" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
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
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AspProvider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "apiVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AspProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AspConnection" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "credentialsRef" TEXT,
    "participantId" TEXT,
    "endpointScheme" TEXT,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AspConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxIdentifier" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "verifiedStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "storeId" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderNumber" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'generated',
    "financialStatus" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceStatusEvent" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "creditNoteId" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'system',
    "message" TEXT,
    "metadata" JSONB,
    "payloadRef" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "reason" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "lineItems" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "publicAccessCreditNote" JSONB,
    "publicAccessRefundDocument" JSONB,
    "verification" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" TEXT NOT NULL,
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
    "thumbnailJpeg" BYTEA,
    "thumbnailGeneratedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopExtraFeature" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "trustedBadgesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wishlistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "speedOptimizerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metadataOptimizerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "upsellEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopExtraFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedBadge" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "iconType" TEXT NOT NULL DEFAULT 'preset',
    "iconValue" TEXT NOT NULL DEFAULT 'shield',
    "labelText" TEXT NOT NULL,
    "badgeColor" TEXT NOT NULL DEFAULT '#000000',
    "textColor" TEXT NOT NULL DEFAULT '#000000',
    "fontSize" INTEGER NOT NULL DEFAULT 14,
    "borderRadius" INTEGER NOT NULL DEFAULT 4,
    "position" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "iconStyle" TEXT NOT NULL DEFAULT 'heart',
    "iconAnimation" TEXT NOT NULL DEFAULT 'fill',
    "iconColor" TEXT NOT NULL DEFAULT '#ff4757',
    "iconColorActive" TEXT NOT NULL DEFAULT '#ffffff',
    "iconSize" INTEGER NOT NULL DEFAULT 20,
    "bgColor" TEXT NOT NULL DEFAULT '#ffffff',
    "bgColorActive" TEXT NOT NULL DEFAULT '#ff4757',
    "padding" INTEGER NOT NULL DEFAULT 4,
    "borderRadius" INTEGER NOT NULL DEFAULT 50,
    "showOnHover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeedOptimizerSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "excludedPages" TEXT NOT NULL DEFAULT '/cart,/account,/checkout',
    "prefetchLimit" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeedOptimizerSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellTimer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "productHandle" TEXT,
    "originalPrice" INTEGER NOT NULL,
    "originalCompareAtPrice" INTEGER,
    "timerPrice" INTEGER NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revertJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpsellTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoScanResult" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceHandle" TEXT,
    "resourceName" TEXT,
    "resourceUrl" TEXT,
    "currentSeoTitle" TEXT,
    "currentSeoDescription" TEXT,
    "resourceBodySummary" TEXT,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'needs_fix',
    "optimizedSeoTitle" TEXT,
    "optimizedSeoDescription" TEXT,
    "imageGid" TEXT,
    "currentImageAlt" TEXT,
    "optimizedImageAlt" TEXT,
    "currentHandle" TEXT,
    "optimizedHandle" TEXT,
    "lastScannedAt" TIMESTAMP(3),
    "lastOptimizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopBranding_shop_key" ON "ShopBranding"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopifyDomain_key" ON "Store"("shopifyDomain");

-- CreateIndex
CREATE INDEX "Store_merchantId_idx" ON "Store"("merchantId");

-- CreateIndex
CREATE INDEX "LegalEntity_merchantId_idx" ON "LegalEntity"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "AspProvider_code_key" ON "AspProvider"("code");

-- CreateIndex
CREATE INDEX "AspConnection_legalEntityId_idx" ON "AspConnection"("legalEntityId");

-- CreateIndex
CREATE INDEX "AspConnection_providerId_idx" ON "AspConnection"("providerId");

-- CreateIndex
CREATE INDEX "AspConnection_status_idx" ON "AspConnection"("status");

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
CREATE INDEX "Invoice_merchantId_status_createdAt_idx" ON "Invoice"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_storeId_createdAt_idx" ON "Invoice"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_storeId_issueDate_idx" ON "Invoice"("storeId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_storeId_status_idx" ON "Invoice"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_storeId_shopifyOrderId_key" ON "Invoice"("storeId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_legalEntityId_invoiceNumber_key" ON "Invoice"("legalEntityId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceStatusEvent_invoiceId_occurredAt_idx" ON "InvoiceStatusEvent"("invoiceId", "occurredAt");

-- CreateIndex
CREATE INDEX "CreditNote_storeId_idx" ON "CreditNote"("storeId");

-- CreateIndex
CREATE INDEX "CreditNote_merchantId_idx" ON "CreditNote"("merchantId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_storeId_createdAt_idx" ON "CreditNote"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_storeId_shopifyRefundId_key" ON "CreditNote"("storeId", "shopifyRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_storeId_creditNoteNumber_key" ON "CreditNote"("storeId", "creditNoteNumber");

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

-- CreateIndex
CREATE UNIQUE INDEX "ShopExtraFeature_shop_key" ON "ShopExtraFeature"("shop");

-- CreateIndex
CREATE INDEX "ShopExtraFeature_shop_idx" ON "ShopExtraFeature"("shop");

-- CreateIndex
CREATE INDEX "TrustedBadge_shop_position_idx" ON "TrustedBadge"("shop", "position");

-- CreateIndex
CREATE INDEX "TrustedBadge_shop_published_idx" ON "TrustedBadge"("shop", "published");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistSetting_shop_key" ON "WishlistSetting"("shop");

-- CreateIndex
CREATE INDEX "WishlistSetting_shop_idx" ON "WishlistSetting"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SpeedOptimizerSetting_shop_key" ON "SpeedOptimizerSetting"("shop");

-- CreateIndex
CREATE INDEX "SpeedOptimizerSetting_shop_idx" ON "SpeedOptimizerSetting"("shop");

-- CreateIndex
CREATE INDEX "UpsellTimer_shop_variantGid_idx" ON "UpsellTimer"("shop", "variantGid");

-- CreateIndex
CREATE INDEX "UpsellTimer_shop_status_idx" ON "UpsellTimer"("shop", "status");

-- CreateIndex
CREATE INDEX "UpsellTimer_shop_productHandle_idx" ON "UpsellTimer"("shop", "productHandle");

-- CreateIndex
CREATE INDEX "SeoScanResult_shop_status_idx" ON "SeoScanResult"("shop", "status");

-- CreateIndex
CREATE INDEX "SeoScanResult_shop_resourceType_idx" ON "SeoScanResult"("shop", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "SeoScanResult_shop_shopifyGid_key" ON "SeoScanResult"("shop", "shopifyGid");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AspConnection" ADD CONSTRAINT "AspConnection_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AspConnection" ADD CONSTRAINT "AspConnection_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AspProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIdentifier" ADD CONSTRAINT "TaxIdentifier_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusEvent" ADD CONSTRAINT "InvoiceStatusEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

