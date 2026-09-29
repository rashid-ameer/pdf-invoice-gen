-- CreateTable
CREATE TABLE "ShopBranding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#008060',
    "secondaryColor" TEXT NOT NULL DEFAULT '#6d7175',
    "accentColor" TEXT NOT NULL DEFAULT '#004c3f',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "footerText" TEXT NOT NULL DEFAULT 'Thank you for your business',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopBranding_shop_key" ON "ShopBranding"("shop");
