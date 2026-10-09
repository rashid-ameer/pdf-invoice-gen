import type { LoaderFunctionArgs } from "react-router";

import {
  getStorefrontShop,
  storefrontJsonCached,
} from "../models/storefront-api.server";
import { listPublishedBadges } from "../models/trusted-badges.server";

/**
 * Published trusted badges for the theme embed.
 * App proxy: /apps/pdf-invoice/trusted-badges
 * Also accepts ?shopify_domain= / ?shop= (absolute app URL fallback).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return storefrontJsonCached([], "public, max-age=60");
  }

  try {
    const shop = await getStorefrontShop(request);
    const badges = await listPublishedBadges(shop);
    return storefrontJsonCached(
      badges,
      "public, max-age=60, stale-while-revalidate=300",
    );
  } catch {
    return storefrontJsonCached(
      [],
      "public, max-age=60, stale-while-revalidate=300",
    );
  }
};
