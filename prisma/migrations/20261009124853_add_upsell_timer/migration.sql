-- CreateTable
CREATE TABLE "UpsellTimer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantGid" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "productHandle" TEXT,
    "originalPrice" INTEGER NOT NULL,
    "originalCompareAtPrice" INTEGER,
    "timerPrice" INTEGER NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revertJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "UpsellTimer_shop_variantGid_idx" ON "UpsellTimer"("shop", "variantGid");

-- CreateIndex
CREATE INDEX "UpsellTimer_shop_status_idx" ON "UpsellTimer"("shop", "status");

-- CreateIndex
CREATE INDEX "UpsellTimer_shop_productHandle_idx" ON "UpsellTimer"("shop", "productHandle");
