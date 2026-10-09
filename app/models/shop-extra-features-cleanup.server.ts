import prisma from "../db.server";

/**
 * Delete store extra-feature rows keyed by shop domain
 * (Trusted Badges, Wishlist, Speed Optimizer, Upsell timers, SEO scan results).
 *
 * Note (Genie parity): UpsellTimer rows are deleted without reverting live
 * Shopify variant prices — active sales can stick after uninstall.
 * SeoScanResult rows are deleted without reverting Shopify SEO/handles/alt.
 */
export async function deleteShopExtraFeatureData(shopDomain: string) {
  const shop = shopDomain.toString().trim().toLowerCase();
  if (!shop) return;

  await prisma.trustedBadge.deleteMany({ where: { shop } });
  await prisma.wishlistSetting.deleteMany({ where: { shop } });
  await prisma.speedOptimizerSetting.deleteMany({ where: { shop } });
  await prisma.upsellTimer.deleteMany({ where: { shop } });
  await prisma.seoScanResult.deleteMany({ where: { shop } });
  await prisma.shopExtraFeature.deleteMany({ where: { shop } });
}
