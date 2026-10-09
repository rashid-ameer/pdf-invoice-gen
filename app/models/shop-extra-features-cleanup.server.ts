import prisma from "../db.server";

/**
 * Delete store extra-feature rows keyed by shop domain
 * (Trusted Badges flags + badges; more tables as features are ported).
 */
export async function deleteShopExtraFeatureData(shopDomain: string) {
  const shop = shopDomain.toString().trim().toLowerCase();
  if (!shop) return;

  await prisma.trustedBadge.deleteMany({ where: { shop } });
  await prisma.shopExtraFeature.deleteMany({ where: { shop } });
}
