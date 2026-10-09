-- CreateTable
CREATE TABLE "SeoScanResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceHandle" TEXT,
    "resourceName" TEXT,
    "resourceUrl" TEXT,
    "currentSeoTitle" TEXT,
    "currentSeoDescription" TEXT,
    "resourceBodySummary" TEXT,
    "issues" JSONB NOT NULL DEFAULT [],
    "status" TEXT NOT NULL DEFAULT 'needs_fix',
    "optimizedSeoTitle" TEXT,
    "optimizedSeoDescription" TEXT,
    "imageGid" TEXT,
    "currentImageAlt" TEXT,
    "optimizedImageAlt" TEXT,
    "currentHandle" TEXT,
    "optimizedHandle" TEXT,
    "lastScannedAt" DATETIME,
    "lastOptimizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SeoScanResult_shop_status_idx" ON "SeoScanResult"("shop", "status");

-- CreateIndex
CREATE INDEX "SeoScanResult_shop_resourceType_idx" ON "SeoScanResult"("shop", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "SeoScanResult_shop_shopifyGid_key" ON "SeoScanResult"("shop", "shopifyGid");
