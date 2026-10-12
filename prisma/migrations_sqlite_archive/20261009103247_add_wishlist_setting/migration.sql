-- CreateTable
CREATE TABLE "WishlistSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WishlistSetting_shop_key" ON "WishlistSetting"("shop");

-- CreateIndex
CREATE INDEX "WishlistSetting_shop_idx" ON "WishlistSetting"("shop");
