-- CreateTable
CREATE TABLE "SpeedOptimizerSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "excludedPages" TEXT NOT NULL DEFAULT '/cart,/account,/checkout',
    "prefetchLimit" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeedOptimizerSetting_shop_key" ON "SpeedOptimizerSetting"("shop");

-- CreateIndex
CREATE INDEX "SpeedOptimizerSetting_shop_idx" ON "SpeedOptimizerSetting"("shop");
