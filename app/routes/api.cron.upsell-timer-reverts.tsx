import type { LoaderFunctionArgs } from "react-router";

import { authorizeCronRequest } from "../models/cron-auth.server";
import { revertDueTimers } from "../models/upsell-timers.server";
import { unauthenticated } from "../shopify.server";

/**
 * Revert expired upsell timer sale prices.
 *
 * Production: external cron every 5–15 min
 *   URL:  https://YOUR_DOMAIN/api/cron/upsell-timer-reverts
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * Local: npm run upsell-timers:run
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authorizeCronRequest(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await revertDueTimers(async (shop) => {
      const { admin } = await unauthenticated.admin(shop);
      return admin;
    });
    console.log("[cron] upsell-timer-reverts", result);
    return Response.json(result);
  } catch (error) {
    console.error("[cron] upsell-timer-reverts failed", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Upsell timer revert failed",
      },
      { status: 500 },
    );
  }
};
