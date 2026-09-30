import type { Session } from "@shopify/shopify-api";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { DEFAULT_CURRENCY } from "../constants/app";
import prisma from "../db.server";
import { encryptSecret } from "../utils/token-crypto";
import { fetchShopInstallInfo } from "./shop-install.server";

/** Old StoreBranding schema defaults used on first install. */
const INSTALL_BRANDING_DEFAULTS = {
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  logoUrl: "",
  footerText: "",
  socialLinks: { showOnInvoice: false },
};

export async function handleAppInstall(
  session: Session,
  admin: AdminApiContext,
  tokenMeta: {
    refreshToken?: string;
    refreshTokenExpiresAt?: Date;
  } = {},
) {
  const shopDomain = session.shop;
  const fallbackName =
    shopDomain.replace(/\.myshopify\.com$/i, "") || shopDomain;

  let shopData: {
    id: string;
    name: string;
    email: string;
    domain: string;
    currency: string;
    timezone: string;
  };

  try {
    shopData = await fetchShopInstallInfo(admin, shopDomain);
  } catch (error) {
    // Never block install/redirect on Admin API hiccups — create a usable Store from the session.
    console.warn(
      "[install] shop GraphQL lookup failed; using session fallback:",
      error,
    );
    shopData = {
      id: shopDomain,
      name: fallbackName,
      email: "",
      domain: shopDomain,
      currency: DEFAULT_CURRENCY,
      timezone: "UTC",
    };
  }

  let merchant = await prisma.merchant.findFirst({
    where: { name: shopData.name },
  });
  if (!merchant) {
    merchant = await prisma.merchant.create({
      data: {
        name: shopData.name || shopDomain,
        billingStatus: "active",
      },
    });
  }

  let store = await prisma.store.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  const encryptedAccessToken = encryptSecret(session.accessToken!)!;
  const encryptedRefreshToken = tokenMeta.refreshToken
    ? encryptSecret(tokenMeta.refreshToken)
    : undefined;

  if (store) {
    store = await prisma.store.update({
      where: { id: store.id },
      data: {
        merchantId: merchant.id,
        accessToken: encryptedAccessToken,
        shopifyStoreId: String(shopData.id),
        status: "active",
        currency: shopData.currency || DEFAULT_CURRENCY,
        timezone: shopData.timezone || "UTC",
        ...(encryptedRefreshToken
          ? { refreshToken: encryptedRefreshToken }
          : {}),
        ...(session.expires
          ? { accessTokenExpiresAt: session.expires }
          : {}),
        ...(tokenMeta.refreshTokenExpiresAt
          ? { refreshTokenExpiresAt: tokenMeta.refreshTokenExpiresAt }
          : {}),
      },
    });
  } else {
    store = await prisma.store.create({
      data: {
        merchantId: merchant.id,
        shopifyDomain: shopDomain,
        shopifyStoreId: String(shopData.id),
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        accessTokenExpiresAt: session.expires ?? null,
        refreshTokenExpiresAt: tokenMeta.refreshTokenExpiresAt ?? null,
        currency: shopData.currency || DEFAULT_CURRENCY,
        timezone: shopData.timezone || "UTC",
        invoiceMode: "standard",
        status: "active",
      },
    });

    const brandingExists = await prisma.shopBranding.findUnique({
      where: { shop: shopDomain },
    });
    if (!brandingExists) {
      await prisma.shopBranding.create({
        data: {
          shop: shopDomain,
          ...INSTALL_BRANDING_DEFAULTS,
        },
      });
    }
  }

  return {
    merchant,
    store,
    shopData,
  };
}

export async function handleAppUninstall(shopDomain: string) {
  await prisma.store.updateMany({
    where: { shopifyDomain: shopDomain },
    data: { status: "uninstalled" },
  });
  console.log(`[shopify] app uninstalled: ${shopDomain}`);
}
