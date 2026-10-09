import type { LoaderFunctionArgs } from "react-router";

import { getExtraFeatureFlagsPublic } from "../models/shop-extra-features.server";
import {
  getStorefrontShop,
  storefrontJsonCached,
} from "../models/storefront-api.server";

/**
 * Public flags for the theme embed.
 * App proxy: /apps/pdf-invoice/extra-feature-flags
 * Also accepts ?shopify_domain= / ?shop= (absolute app URL fallback).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return storefrontJsonCached({}, "public, max-age=300");
  }

  try {
    const shop = await getStorefrontShop(request);
    return storefrontJsonCached(
      await getExtraFeatureFlagsPublic(shop),
      "public, max-age=300, stale-while-revalidate=1800",
    );
  } catch {
    return storefrontJsonCached(
      {
        trusted_badges_enabled: false,
        wishlist_enabled: false,
        speed_optimizer_enabled: false,
        metadata_optimizer_enabled: false,
        upsell_enabled: false,
      },
      "public, max-age=300, stale-while-revalidate=1800",
    );
  }
};
