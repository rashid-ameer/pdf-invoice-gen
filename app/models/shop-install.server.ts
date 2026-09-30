import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export type ShopInstallInfo = {
  id: string;
  name: string;
  email: string;
  domain: string;
  currency: string;
  timezone: string;
};

const SHOP_INSTALL_QUERY = `#graphql
  query ShopInstall {
    shop {
      id
      name
      email
      myshopifyDomain
      currencyCode
      ianaTimezone
    }
  }
`;

export function numericIdFromGid(
  gidOrId: string | number | null | undefined,
): string {
  const raw = String(gidOrId ?? "").trim();
  if (!raw) return "";
  if (raw.includes("/")) return raw.split("/").pop() || raw;
  return raw;
}

export async function fetchShopInstallInfo(
  admin: AdminApiContext,
  shopDomain: string,
): Promise<ShopInstallInfo> {
  const response = await admin.graphql(SHOP_INSTALL_QUERY);
  const json = (await response.json()) as {
    data?: {
      shop?: {
        id?: string;
        name?: string;
        email?: string;
        myshopifyDomain?: string;
        currencyCode?: string;
        ianaTimezone?: string;
      };
    };
  };
  const shop = json.data?.shop;
  if (!shop) throw new Error("Shopify shop query returned no shop");
  return {
    id: numericIdFromGid(shop.id),
    name: shop.name || shopDomain,
    email: shop.email || "",
    domain: shop.myshopifyDomain || shopDomain,
    currency: shop.currencyCode || "USD",
    timezone: shop.ianaTimezone || "UTC",
  };
}
