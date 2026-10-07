import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleAppUninstall } from "../models/install.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook can fire multiple times after uninstall. handleAppUninstall is
  // idempotent and always clears all sessions for the shop (old parity) —
  // it must not depend on a session being present on the webhook payload.
  await handleAppUninstall(shop);

  return new Response();
};
