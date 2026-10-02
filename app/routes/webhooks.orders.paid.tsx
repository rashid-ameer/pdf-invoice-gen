import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleOrderCreated } from "../models/invoice-create.server";
import type { ShopifyOrder } from "../models/invoice-create.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await handleOrderCreated(shop, payload as ShopifyOrder, topic);

  return new Response();
};
