import type { LoaderFunctionArgs } from "react-router";

import {
  getStorefrontShop,
  storefrontJsonCached,
} from "../models/storefront-api.server";
import {
  getWishlistSettings,
  toPublicSnakeCase,
} from "../models/wishlist-settings.server";

/**
 * Wishlist button settings for the theme embed.
 * App proxy: /apps/pdf-invoice/wishlist-settings
 * Also accepts ?shopify_domain= / ?shop= (absolute app URL fallback).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return storefrontJsonCached({ enabled: false }, "public, max-age=60");
  }

  try {
    const shop = await getStorefrontShop(request);
    const settings = await getWishlistSettings(shop);
    return storefrontJsonCached(
      toPublicSnakeCase(settings),
      "public, max-age=60, stale-while-revalidate=300",
    );
  } catch {
    return storefrontJsonCached(
      { enabled: false },
      "public, max-age=60, stale-while-revalidate=300",
    );
  }
};
