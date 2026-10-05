import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  handleRefundCreated,
  type ShopifyRefund,
} from "../models/credit-note.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await handleRefundCreated(shop, payload as ShopifyRefund, topic);

  return new Response();
};
