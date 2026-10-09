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
import {
  DEFAULT_WISHLIST_SETTINGS,
  getWishlistSettings,
  saveWishlistSettings,
  toPublicSnakeCase,
} from "../app/models/wishlist-settings.server";
import {
  DEFAULT_SPEED_OPTIMIZER_SETTINGS,
  getSpeedOptimizerSettings,
  saveSpeedOptimizerSettings,
  toPublicSnakeCase as toSpeedOptimizerPublic,
} from "../app/models/speed-optimizer-settings.server";
import {
  defaultUpsellConfig,
  normalizeUpsellConfig,
} from "../app/models/upsell-config";
import {
  createTimer,
  deleteTimersForShop,
  listActiveTimers,
  updateTimerStatus,
} from "../app/models/upsell-timers.server";
import { authorizeCronRequest } from "../app/models/cron-auth.server";

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

describe("wishlist settings", () => {
  it("defaults, save, public snake_case, and cleanup", async () => {
    const shop = shopDomain();
    await createShopExtraFeature(shop, {
      ...DEFAULT_EXTRA_FEATURE_FLAGS,
      wishlistEnabled: true,
    });

    let settings = await getWishlistSettings(shop);
    assert.deepEqual(settings, DEFAULT_WISHLIST_SETTINGS);

    settings = await saveWishlistSettings(shop, {
      enabled: true,
      iconStyle: "star",
      iconSize: 24,
      showOnHover: true,
    });
    assert.equal(settings.enabled, true);
    assert.equal(settings.iconStyle, "star");
    assert.equal(settings.iconSize, 24);
    assert.equal(settings.showOnHover, true);

    const pub = toPublicSnakeCase(settings);
    assert.equal(pub.icon_style, "star");
    assert.equal(pub.icon_size, 24);
    assert.equal(pub.show_on_hover, true);

    await requireExtraFeatureFlag(shop, "wishlistEnabled");

    await deleteShopExtraFeatureData(shop);
    settings = await getWishlistSettings(shop);
    assert.deepEqual(settings, DEFAULT_WISHLIST_SETTINGS);
  });
});

describe("speed optimizer settings", () => {
  it("defaults, save, public snake_case, require flag, and cleanup", async () => {
    const shop = shopDomain();
    await createShopExtraFeature(shop, {
      ...DEFAULT_EXTRA_FEATURE_FLAGS,
      speedOptimizerEnabled: true,
    });

    let settings = await getSpeedOptimizerSettings(shop);
    assert.deepEqual(settings, DEFAULT_SPEED_OPTIMIZER_SETTINGS);

    settings = await saveSpeedOptimizerSettings(shop, {
      enabled: true,
      excludedPages: "/cart,/checkout",
      prefetchLimit: 5,
    });
    assert.equal(settings.enabled, true);
    assert.equal(settings.excludedPages, "/cart,/checkout");
    assert.equal(settings.prefetchLimit, 5);

    const pub = toSpeedOptimizerPublic(settings);
    assert.equal(pub.excluded_pages, "/cart,/checkout");
    assert.equal(pub.prefetch_limit, 5);
    assert.equal(pub.enabled, true);

    await requireExtraFeatureFlag(shop, "speedOptimizerEnabled");

    await deleteShopExtraFeatureData(shop);
    settings = await getSpeedOptimizerSettings(shop);
    assert.deepEqual(settings, DEFAULT_SPEED_OPTIMIZER_SETTINGS);
  });
});

describe("upsell config + timers", () => {
  it("normalize defaults and deep-merge", () => {
    const defaults = defaultUpsellConfig();
    assert.equal(defaults.app_enabled, true);
    const features = defaults.features as Record<string, unknown>;
    const discount = features.discount_upsell as Record<string, unknown>;
    assert.equal(discount.enabled, false);

    const merged = normalizeUpsellConfig({
      app_enabled: false,
      features: {
        discount_upsell: { enabled: true },
      },
    });
    assert.equal(merged.app_enabled, false);
    const mergedFeatures = merged.features as Record<string, unknown>;
    const mergedDiscount = mergedFeatures.discount_upsell as Record<
      string,
      unknown
    >;
    assert.equal(mergedDiscount.enabled, true);
    assert.ok(Array.isArray(mergedDiscount.rules));
  });

  it("timer CRUD, require flag, cleanup, cron auth", async () => {
    const shop = shopDomain();
    await createShopExtraFeature(shop, {
      ...DEFAULT_EXTRA_FEATURE_FLAGS,
      upsellEnabled: true,
    });

    const endsAt = new Date(Date.now() + 60_000);
    const timer = await createTimer(shop, {
      variantGid: "gid://shopify/ProductVariant/1",
      productGid: "gid://shopify/Product/1",
      productHandle: "test-product",
      originalPrice: 2000,
      originalCompareAtPrice: null,
      timerPrice: 1500,
      endsAt,
    });
    assert.equal(timer.status, "active");

    let active = await listActiveTimers(shop);
    assert.equal(active.length, 1);

    await updateTimerStatus(timer.id, "completed");
    active = await listActiveTimers(shop);
    assert.equal(active.length, 0);

    await requireExtraFeatureFlag(shop, "upsellEnabled");

    // Recreate active timer so cleanup path deletes it
    await createTimer(shop, {
      variantGid: "gid://shopify/ProductVariant/2",
      productGid: "gid://shopify/Product/2",
      originalPrice: 1000,
      timerPrice: 800,
      endsAt,
    });

    await deleteShopExtraFeatureData(shop);
    active = await listActiveTimers(shop);
    assert.equal(active.length, 0);
    await deleteTimersForShop(shop);

    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    try {
      assert.equal(
        authorizeCronRequest(
          new Request("http://localhost/api/cron/x", {
            headers: { Authorization: "Bearer test-cron-secret" },
          }),
        ),
        true,
      );
      assert.equal(
        authorizeCronRequest(new Request("http://localhost/api/cron/x")),
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
