import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";
import {
  createShopExtraFeature,
  DEFAULT_EXTRA_FEATURE_FLAGS,
  getExtraFeatureFlags,
  getExtraFeatureFlagsPublic,
  isExtraFeaturesAdmin,
  requireExtraFeatureFlag,
  toPublicFlags,
  updateShopExtraFeature,
  deleteShopExtraFeature,
} from "../app/models/shop-extra-features.server";
import {
  bulkReorder,
  createBadge,
  deleteBadge,
  listBadges,
  listPublishedBadges,
  updateBadge,
} from "../app/models/trusted-badges.server";
import { deleteShopExtraFeatureData } from "../app/models/shop-extra-features-cleanup.server";

const cleanupShops: string[] = [];

after(async () => {
  for (const shop of cleanupShops) {
    await deleteShopExtraFeatureData(shop);
  }
  await prisma.$disconnect();
});

function shopDomain() {
  const shop = `extras-${randomUUID()}.myshopify.com`;
  cleanupShops.push(shop);
  return shop;
}

describe("shop extra feature flags", () => {
  it("defaults to all flags off when no row exists", async () => {
    const shop = shopDomain();
    const flags = await getExtraFeatureFlags(shop);
    assert.deepEqual(flags, DEFAULT_EXTRA_FEATURE_FLAGS);
    assert.deepEqual(toPublicFlags(flags), {
      trusted_badges_enabled: false,
      wishlist_enabled: false,
      speed_optimizer_enabled: false,
      metadata_optimizer_enabled: false,
      upsell_enabled: false,
    });
  });

  it("create / update / public flags / require gate", async () => {
    const shop = shopDomain();
    const created = await createShopExtraFeature(shop, {
      ...DEFAULT_EXTRA_FEATURE_FLAGS,
      trustedBadgesEnabled: true,
    });
    assert.equal(created.shop, shop);
    assert.equal(created.trustedBadgesEnabled, true);

    let flags = await getExtraFeatureFlags(shop);
    assert.equal(flags.trustedBadgesEnabled, true);
    assert.equal(flags.wishlistEnabled, false);

    const pub = await getExtraFeatureFlagsPublic(shop);
    assert.equal(pub.trusted_badges_enabled, true);

    await requireExtraFeatureFlag(shop, "trustedBadgesEnabled");

    let redirected = false;
    try {
      await requireExtraFeatureFlag(shop, "wishlistEnabled");
    } catch (error) {
      redirected = error instanceof Response && error.status === 302;
    }
    assert.equal(redirected, true);

    await updateShopExtraFeature(created.id, shop, {
      ...DEFAULT_EXTRA_FEATURE_FLAGS,
      wishlistEnabled: true,
    });
    flags = await getExtraFeatureFlags(shop);
    assert.equal(flags.wishlistEnabled, true);
    assert.equal(flags.trustedBadgesEnabled, false);

    await deleteShopExtraFeature(created.id);
    flags = await getExtraFeatureFlags(shop);
    assert.deepEqual(flags, DEFAULT_EXTRA_FEATURE_FLAGS);
  });

  it("isExtraFeaturesAdmin reads SHOP_EXTRA_FEATURES_ADMIN_DOMAINS", () => {
    const prev = process.env.SHOP_EXTRA_FEATURES_ADMIN_DOMAINS;
    process.env.SHOP_EXTRA_FEATURES_ADMIN_DOMAINS =
      "Admin-Shop.myshopify.com, other.myshopify.com";
    try {
      assert.equal(isExtraFeaturesAdmin("admin-shop.myshopify.com"), true);
      assert.equal(isExtraFeaturesAdmin("unknown.myshopify.com"), false);
    } finally {
      if (prev === undefined) {
        delete process.env.SHOP_EXTRA_FEATURES_ADMIN_DOMAINS;
      } else {
        process.env.SHOP_EXTRA_FEATURES_ADMIN_DOMAINS = prev;
      }
    }
  });
});

describe("trusted badges", () => {
  it("CRUD, publish filter, reorder, and cleanup", async () => {
    const shop = shopDomain();
    await createShopExtraFeature(shop, {
      ...DEFAULT_EXTRA_FEATURE_FLAGS,
      trustedBadgesEnabled: true,
    });

    const a = await createBadge(shop, {
      label_text: "Secure checkout",
      icon_type: "preset",
      icon_value: "shield",
      published: true,
    });
    const b = await createBadge(shop, {
      label_text: "Free returns",
      icon_type: "preset",
      icon_value: "return",
      published: false,
    });

    let all = await listBadges(shop);
    assert.equal(all.length, 2);
    assert.equal((await listPublishedBadges(shop)).length, 1);

    await updateBadge(shop, b.id, { published: true });
    assert.equal((await listPublishedBadges(shop)).length, 2);

    await bulkReorder(shop, [b.id, a.id]);
    all = await listBadges(shop);
    assert.equal(all[0].id, b.id);
    assert.equal(all[0].position, 0);
    assert.equal(all[1].id, a.id);
    assert.equal(all[1].position, 1);

    await deleteBadge(shop, a.id);
    assert.equal((await listBadges(shop)).length, 1);

    await deleteShopExtraFeatureData(shop);
    assert.equal((await listBadges(shop)).length, 0);
    assert.deepEqual(await getExtraFeatureFlags(shop), DEFAULT_EXTRA_FEATURE_FLAGS);
  });
});
