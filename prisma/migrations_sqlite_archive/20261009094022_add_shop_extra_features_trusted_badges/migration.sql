-- CreateTable
CREATE TABLE "ShopExtraFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "trustedBadgesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wishlistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "speedOptimizerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metadataOptimizerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "upsellEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrustedBadge" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopExtraFeature_shop_key" ON "ShopExtraFeature"("shop");

-- CreateIndex
CREATE INDEX "ShopExtraFeature_shop_idx" ON "ShopExtraFeature"("shop");

-- CreateIndex
CREATE INDEX "TrustedBadge_shop_position_idx" ON "TrustedBadge"("shop", "position");

-- CreateIndex
CREATE INDEX "TrustedBadge_shop_published_idx" ON "TrustedBadge"("shop", "published");
