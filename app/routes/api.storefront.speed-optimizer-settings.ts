import type { LoaderFunctionArgs } from "react-router";

import {
  getStorefrontShop,
  storefrontJsonCached,
} from "../models/storefront-api.server";
import {
  getSpeedOptimizerSettings,
  toPublicSnakeCase,
} from "../models/speed-optimizer-settings.server";

/**
 * Speed optimizer settings for the theme embed.
 * App proxy: /apps/pdf-invoice/speed-optimizer-settings
 * Also accepts ?shopify_domain= / ?shop= (absolute app URL fallback).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return storefrontJsonCached({ enabled: false }, "public, max-age=60");
  }

  try {
    const shop = await getStorefrontShop(request);
    const settings = await getSpeedOptimizerSettings(shop);
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
