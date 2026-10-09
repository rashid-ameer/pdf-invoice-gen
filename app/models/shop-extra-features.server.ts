import prisma from '../db.server';

export type ExtraFeatureFlags = {
  trustedBadgesEnabled: boolean;
  wishlistEnabled: boolean;
  speedOptimizerEnabled: boolean;
  metadataOptimizerEnabled: boolean;
  upsellEnabled: boolean;
};

/** Snake_case payload for theme embed / public API (Rails parity). */
export type ExtraFeatureFlagsPublic = {
  trusted_badges_enabled: boolean;
  wishlist_enabled: boolean;
  speed_optimizer_enabled: boolean;
  metadata_optimizer_enabled: boolean;
  upsell_enabled: boolean;
};

export type ShopExtraFeatureRecord = ExtraFeatureFlags & {
  id: string;
  shop: string;
};

export const DEFAULT_EXTRA_FEATURE_FLAGS: ExtraFeatureFlags = {
  trustedBadgesEnabled: false,
  wishlistEnabled: false,
  speedOptimizerEnabled: false,
  metadataOptimizerEnabled: false,
  upsellEnabled: false,
};

function normalizeShopDomain(shop: string) {
  return shop.toString().trim().toLowerCase();
}

export function getExtraFeaturesAdminDomains(): string[] {
  return (process.env.SHOP_EXTRA_FEATURES_ADMIN_DOMAINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isExtraFeaturesAdmin(shop: string): boolean {
  const domain = normalizeShopDomain(shop);
  if (!domain) return false;
  return getExtraFeaturesAdminDomains().includes(domain);
}

export function toPublicFlags(flags: ExtraFeatureFlags): ExtraFeatureFlagsPublic {
  return {
    trusted_badges_enabled: flags.trustedBadgesEnabled,
    wishlist_enabled: flags.wishlistEnabled,
    speed_optimizer_enabled: flags.speedOptimizerEnabled,
    metadata_optimizer_enabled: flags.metadataOptimizerEnabled,
    upsell_enabled: flags.upsellEnabled,
  };
}

function rowToFlags(row: {
  trustedBadgesEnabled: boolean;
  wishlistEnabled: boolean;
  speedOptimizerEnabled: boolean;
  metadataOptimizerEnabled: boolean;
  upsellEnabled: boolean;
}): ExtraFeatureFlags {
  return {
    trustedBadgesEnabled: row.trustedBadgesEnabled,
    wishlistEnabled: row.wishlistEnabled,
    speedOptimizerEnabled: row.speedOptimizerEnabled,
    metadataOptimizerEnabled: row.metadataOptimizerEnabled,
    upsellEnabled: row.upsellEnabled,
  };
}

function rowToRecord(row: {
  id: string;
  shop: string;
  trustedBadgesEnabled: boolean;
  wishlistEnabled: boolean;
  speedOptimizerEnabled: boolean;
  metadataOptimizerEnabled: boolean;
  upsellEnabled: boolean;
}): ShopExtraFeatureRecord {
  return {
    id: row.id,
    shop: row.shop,
    ...rowToFlags(row),
  };
}

export async function getExtraFeatureFlags(
  shop: string,
): Promise<ExtraFeatureFlags> {
  const domain = normalizeShopDomain(shop);
  if (!domain) return {...DEFAULT_EXTRA_FEATURE_FLAGS};

  const row = await prisma.shopExtraFeature.findUnique({
    where: {shop: domain},
    select: {
      trustedBadgesEnabled: true,
      wishlistEnabled: true,
      speedOptimizerEnabled: true,
      metadataOptimizerEnabled: true,
      upsellEnabled: true,
    },
  });

  return row ? rowToFlags(row) : {...DEFAULT_EXTRA_FEATURE_FLAGS};
}

export async function getExtraFeatureFlagsPublic(
  shop: string,
): Promise<ExtraFeatureFlagsPublic> {
  return toPublicFlags(await getExtraFeatureFlags(shop));
}

/** List all shop feature-flag rows (admin multi-store page). */
export async function listShopExtraFeatures(): Promise<ShopExtraFeatureRecord[]> {
  const rows = await prisma.shopExtraFeature.findMany({
    orderBy: {shop: 'asc'},
    select: {
      id: true,
      shop: true,
      trustedBadgesEnabled: true,
      wishlistEnabled: true,
      speedOptimizerEnabled: true,
      metadataOptimizerEnabled: true,
      upsellEnabled: true,
    },
  });
  return rows.map(rowToRecord);
}

export async function createShopExtraFeature(
  shopifyDomain: string,
  flags: ExtraFeatureFlags,
): Promise<ShopExtraFeatureRecord> {
  const domain = normalizeShopDomain(shopifyDomain);
  if (!domain) {
    throw new Error('Shopify domain is required');
  }
  if (!domain.includes('.')) {
    throw new Error('Enter a valid Shopify domain (e.g. my-store.myshopify.com)');
  }

  const existing = await prisma.shopExtraFeature.findUnique({
    where: {shop: domain},
    select: {id: true},
  });
  if (existing) {
    throw new Error('A record for this store domain already exists');
  }

  const row = await prisma.shopExtraFeature.create({
    data: {
      shop: domain,
      trustedBadgesEnabled: flags.trustedBadgesEnabled,
      wishlistEnabled: flags.wishlistEnabled,
      speedOptimizerEnabled: flags.speedOptimizerEnabled,
      metadataOptimizerEnabled: flags.metadataOptimizerEnabled,
      upsellEnabled: flags.upsellEnabled,
    },
  });
  return rowToRecord(row);
}

export async function updateShopExtraFeature(
  id: string,
  shopifyDomain: string,
  flags: ExtraFeatureFlags,
): Promise<ShopExtraFeatureRecord> {
  const domain = normalizeShopDomain(shopifyDomain);
  if (!domain) {
    throw new Error('Shopify domain is required');
  }
  if (!domain.includes('.')) {
    throw new Error('Enter a valid Shopify domain (e.g. my-store.myshopify.com)');
  }

  const current = await prisma.shopExtraFeature.findUnique({
    where: {id},
    select: {id: true},
  });
  if (!current) {
    throw new Error('Not found');
  }

  const conflict = await prisma.shopExtraFeature.findFirst({
    where: {shop: domain, NOT: {id}},
    select: {id: true},
  });
  if (conflict) {
    throw new Error('A record for this store domain already exists');
  }

  const row = await prisma.shopExtraFeature.update({
    where: {id},
    data: {
      shop: domain,
      trustedBadgesEnabled: flags.trustedBadgesEnabled,
      wishlistEnabled: flags.wishlistEnabled,
      speedOptimizerEnabled: flags.speedOptimizerEnabled,
      metadataOptimizerEnabled: flags.metadataOptimizerEnabled,
      upsellEnabled: flags.upsellEnabled,
    },
  });
  return rowToRecord(row);
}

export async function deleteShopExtraFeature(id: string): Promise<void> {
  const current = await prisma.shopExtraFeature.findUnique({
    where: {id},
    select: {id: true},
  });
  if (!current) {
    throw new Error('Not found');
  }
  await prisma.shopExtraFeature.delete({where: {id}});
}

export async function upsertExtraFeatureFlags(
  shop: string,
  flags: Partial<ExtraFeatureFlags>,
): Promise<ExtraFeatureFlags> {
  const domain = normalizeShopDomain(shop);
  const row = await prisma.shopExtraFeature.upsert({
    where: {shop: domain},
    create: {
      shop: domain,
      trustedBadgesEnabled: flags.trustedBadgesEnabled ?? false,
      wishlistEnabled: flags.wishlistEnabled ?? false,
      speedOptimizerEnabled: flags.speedOptimizerEnabled ?? false,
      metadataOptimizerEnabled: flags.metadataOptimizerEnabled ?? false,
      upsellEnabled: flags.upsellEnabled ?? false,
    },
    update: {
      ...(flags.trustedBadgesEnabled !== undefined
        ? {trustedBadgesEnabled: flags.trustedBadgesEnabled}
        : {}),
      ...(flags.wishlistEnabled !== undefined
        ? {wishlistEnabled: flags.wishlistEnabled}
        : {}),
      ...(flags.speedOptimizerEnabled !== undefined
        ? {speedOptimizerEnabled: flags.speedOptimizerEnabled}
        : {}),
      ...(flags.metadataOptimizerEnabled !== undefined
        ? {metadataOptimizerEnabled: flags.metadataOptimizerEnabled}
        : {}),
      ...(flags.upsellEnabled !== undefined
        ? {upsellEnabled: flags.upsellEnabled}
        : {}),
    },
  });
  return rowToFlags(row);
}

export function parseExtraFeatureFlagsForm(
  formData: FormData,
): ExtraFeatureFlags {
  const on = (name: string) =>
    formData.get(name) === 'true' || formData.get(name) === 'on';
  return {
    trustedBadgesEnabled: on('trustedBadgesEnabled'),
    wishlistEnabled: on('wishlistEnabled'),
    speedOptimizerEnabled: on('speedOptimizerEnabled'),
    metadataOptimizerEnabled: on('metadataOptimizerEnabled'),
    upsellEnabled: on('upsellEnabled'),
  };
}

/** Redirect home when a gated feature flag is off. */
export async function requireExtraFeatureFlag(
  shop: string,
  flag: keyof ExtraFeatureFlags,
): Promise<ExtraFeatureFlags> {
  const flags = await getExtraFeatureFlags(shop);
  if (!flags[flag]) {
    throw new Response(null, {status: 302, headers: {Location: '/app'}});
  }
  return flags;
}
