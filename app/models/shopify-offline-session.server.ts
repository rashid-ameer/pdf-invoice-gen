import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "../utils/token-crypto";

const REFRESH_SKEW_MS = 60_000;

function offlineSessionId(shopDomain: string): string {
  return `offline_${shopDomain}`;
}

async function refreshOfflineAccessToken(params: {
  shop: string;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  scope?: string;
  expiresAt?: Date;
  refreshToken: string;
  refreshTokenExpiresAt?: Date;
}> {
  const shop = params.shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: process.env.SHOPIFY_API_KEY || "",
      client_secret: process.env.SHOPIFY_API_SECRET || "",
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }).toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    const detail =
      payload.error_description || payload.error || response.statusText;
    throw new Error(
      `Shopify token refresh failed (${response.status}): ${detail}`,
    );
  }

  return {
    accessToken: payload.access_token,
    scope: payload.scope,
    expiresAt:
      payload.expires_in != null
        ? new Date(Date.now() + payload.expires_in * 1000)
        : undefined,
    refreshToken: payload.refresh_token || params.refreshToken,
    refreshTokenExpiresAt:
      payload.refresh_token_expires_in != null
        ? new Date(Date.now() + payload.refresh_token_expires_in * 1000)
        : undefined,
  };
}

/**
 * Resolve a usable offline Admin API access token.
 * Prefers Prisma Session storage, falls back to Store.accessToken.
 * Refreshes expiring offline tokens when close to expiry (old parity).
 */
export async function getOfflineAccessTokenForShop(
  shopDomain: string,
): Promise<string | null> {
  const offlineId = offlineSessionId(shopDomain);
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  const session = await prisma.session.findUnique({ where: { id: offlineId } });

  let accessToken =
    decryptSecret(store?.accessToken) || session?.accessToken || undefined;
  const refreshToken = decryptSecret(store?.refreshToken) || undefined;
  const expiresAt = store?.accessTokenExpiresAt || session?.expires || null;

  if (!accessToken && !refreshToken) return null;

  const needsRefresh =
    Boolean(refreshToken) &&
    (!accessToken ||
      !expiresAt ||
      expiresAt.getTime() <= Date.now() + REFRESH_SKEW_MS);

  if (needsRefresh && refreshToken) {
    try {
      const refreshed = await refreshOfflineAccessToken({
        shop: shopDomain,
        refreshToken,
      });
      accessToken = refreshed.accessToken;

      await prisma.store.updateMany({
        where: { shopifyDomain: shopDomain },
        data: {
          accessToken: encryptSecret(refreshed.accessToken),
          refreshToken: encryptSecret(refreshed.refreshToken),
          accessTokenExpiresAt: refreshed.expiresAt ?? null,
          refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? null,
          status: "active",
        },
      });

      if (session) {
        await prisma.session.update({
          where: { id: offlineId },
          data: {
            accessToken: refreshed.accessToken,
            expires: refreshed.expiresAt ?? null,
            scope: refreshed.scope || session.scope,
          },
        });
      }
    } catch (error) {
      console.warn("[shopify] offline token refresh failed:", error);
    }
  }

  return accessToken || null;
}
