/**
 * Group 15 Phase A — Admin UI extension authentication + CORS.
 *
 * Port of old `server/middleware/extension-auth.ts` for React Router resource routes.
 * Does not implement order-document APIs or extension UI.
 */
import type { Session } from "@shopify/shopify-api";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";

/** Fallback / CDN origin used by Shopify Admin UI extensions. */
export const EXTENSION_ORIGIN = "https://extensions.shopifycdn.com";

export const EXTENSION_CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
export const EXTENSION_CORS_ALLOW_HEADERS =
  "Authorization, Content-Type, Accept, X-Requested-With";

export type ExtensionOfflineSession = Pick<
  Session,
  "id" | "shop" | "accessToken" | "isOnline"
> &
  Partial<Pick<Session, "scope" | "expires" | "state">>;

export type ExtensionAuthDeps = {
  decodeSessionToken: (token: string) => Promise<{ dest?: string }>;
  sanitizeShop: (shop: string) => string | null;
  loadOfflineSession: (
    shop: string,
  ) => Promise<ExtensionOfflineSession | null>;
  /** Override env-configured extra CORS origins (tests). */
  getConfiguredCorsOrigins?: () => string[];
};

export type AdminExtensionAuthContext = {
  shop: string;
  session: ExtensionOfflineSession;
  corsHeaders: Headers;
};

let shopifyApiSingleton: ReturnType<typeof shopifyApi> | null = null;

function getShopifyApi() {
  if (!shopifyApiSingleton) {
    const hostName = (process.env.SHOPIFY_APP_URL || "http://localhost")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    shopifyApiSingleton = shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY || "",
      apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
      scopes: (process.env.SCOPES || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      hostName: hostName || "localhost",
      apiVersion: ApiVersion.July26,
      isEmbeddedApp: true,
    });
  }
  return shopifyApiSingleton;
}

/** Parse `EXTENSIONS_CORS_ORIGINS` (comma-separated). Empty values ignored. */
export function parseConfiguredCorsOrigins(
  raw: string | undefined = process.env.EXTENSIONS_CORS_ORIGINS,
): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Origins Shopify Admin / extensions use when calling the app backend.
 * Matches old `isShopifyExtensionOrigin`, plus optional env allowlist.
 */
export function isShopifyExtensionOrigin(
  origin: string,
  configuredOrigins: string[] = parseConfiguredCorsOrigins(),
): boolean {
  if (!origin) return false;
  if (configuredOrigins.includes(origin)) return true;
  return (
    origin === EXTENSION_ORIGIN ||
    origin === "https://admin.shopify.com" ||
    origin.endsWith(".shopifycloud.com") ||
    origin.endsWith(".myshopify.com") ||
    origin.includes("shopifycdn.com") ||
    origin.includes("admin.shopify.com")
  );
}

/**
 * Build CORS headers for an extension resource response.
 * Echoes the request Origin only when allowlisted (credentialed CORS).
 * Unknown origins do not receive Access-Control-Allow-Origin.
 */
export function buildExtensionCorsHeaders(
  request: Request,
  configuredOrigins: string[] = parseConfiguredCorsOrigins(),
): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin") ?? "";

  if (origin && isShopifyExtensionOrigin(origin, configuredOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  headers.set("Access-Control-Allow-Headers", EXTENSION_CORS_ALLOW_HEADERS);
  headers.set("Access-Control-Allow-Methods", EXTENSION_CORS_ALLOW_METHODS);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}

/** Merge extension CORS headers onto an existing Response. */
export function withExtensionCors(
  request: Request,
  response: Response,
  configuredOrigins?: string[],
): Response {
  const cors = buildExtensionCorsHeaders(request, configuredOrigins);
  const headers = new Headers(response.headers);
  cors.forEach((value, key) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * OPTIONS preflight: 204, CORS only, no authentication.
 * Returns null when the request is not OPTIONS.
 */
export function extensionCorsPreflightResponse(
  request: Request,
  configuredOrigins?: string[],
): Response | null {
  if (request.method.toUpperCase() !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: buildExtensionCorsHeaders(request, configuredOrigins),
  });
}

/**
 * Extract Admin extension session JWT from Bearer / raw Authorization / query.
 * Query keys match old middleware: `token`, `id_token`, `session`.
 */
export function extractExtensionSessionToken(
  request: Request,
): string | undefined {
  const auth = request.headers.get("Authorization");
  if (typeof auth === "string") {
    const value = auth.trim();
    if (!value) {
      // fall through to query
    } else if (value.toLowerCase().startsWith("bearer ")) {
      const token = value.slice(7).trim();
      if (token) return token;
    } else if (value.split(".").length === 3) {
      return value;
    }
  }

  const url = new URL(request.url);
  for (const key of ["id_token", "token", "session"] as const) {
    const value = url.searchParams.get(key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function unauthorizedResponse(
  corsHeaders: Headers,
  error = "Unauthorized",
): Response {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify({ error }), {
    status: 401,
    headers,
  });
}

async function defaultDecodeSessionToken(token: string): Promise<{ dest?: string }> {
  const api = getShopifyApi();
  return api.session.decodeSessionToken(token);
}

function defaultSanitizeShop(shopHost: string): string | null {
  const api = getShopifyApi();
  return api.utils.sanitizeShop(shopHost, true);
}

async function defaultLoadOfflineSession(
  shop: string,
): Promise<ExtensionOfflineSession | null> {
  const { unauthenticated } = await import("../shopify.server");
  try {
    const { session } = await unauthenticated.admin(shop);
    if (!session?.accessToken) return null;
    return session;
  } catch {
    return null;
  }
}

function resolveDeps(deps?: Partial<ExtensionAuthDeps>): ExtensionAuthDeps {
  return {
    decodeSessionToken: deps?.decodeSessionToken ?? defaultDecodeSessionToken,
    sanitizeShop: deps?.sanitizeShop ?? defaultSanitizeShop,
    loadOfflineSession: deps?.loadOfflineSession ?? defaultLoadOfflineSession,
    getConfiguredCorsOrigins:
      deps?.getConfiguredCorsOrigins ?? parseConfiguredCorsOrigins,
  };
}

/**
 * Authenticate an Admin UI extension request.
 *
 * - Applies CORS headers on success and failure responses (via thrown Response).
 * - Accepts `Authorization: Bearer <jwt>` or `?token=` (also `id_token` / `session`).
 * - Shop comes only from the validated token `dest` — never from client shop params.
 * - Requires a usable offline session for that shop.
 *
 * Callers should handle OPTIONS via `extensionCorsPreflightResponse` first.
 * On failure throws a Response with status 401 (no internals exposed).
 */
export async function authenticateAdminExtension(
  request: Request,
  deps?: Partial<ExtensionAuthDeps>,
): Promise<AdminExtensionAuthContext> {
  const resolved = resolveDeps(deps);
  const configuredOrigins = resolved.getConfiguredCorsOrigins
    ? resolved.getConfiguredCorsOrigins()
    : parseConfiguredCorsOrigins();
  const corsHeaders = buildExtensionCorsHeaders(request, configuredOrigins);

  const token = extractExtensionSessionToken(request);
  if (!token) {
    throw unauthorizedResponse(corsHeaders, "Missing session token");
  }

  try {
    const payload = await resolved.decodeSessionToken(token);
    const dest = typeof payload.dest === "string" ? payload.dest : "";
    const shopHost = dest.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const shop = resolved.sanitizeShop(shopHost);
    if (!shop) {
      throw unauthorizedResponse(corsHeaders, "Invalid shop in session token");
    }

    const session = await resolved.loadOfflineSession(shop);
    if (!session?.accessToken) {
      throw unauthorizedResponse(
        corsHeaders,
        "App is not installed for this shop",
      );
    }

    return {
      shop,
      session,
      corsHeaders,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw unauthorizedResponse(corsHeaders, "Invalid session token");
  }
}

/**
 * Convenience for future resource routes:
 * OPTIONS → 204 preflight; otherwise authenticate and return context.
 */
export async function requireAdminExtensionAuth(
  request: Request,
  deps?: Partial<ExtensionAuthDeps>,
): Promise<
  | { kind: "preflight"; response: Response }
  | { kind: "authenticated"; context: AdminExtensionAuthContext }
> {
  const resolved = resolveDeps(deps);
  const configuredOrigins = resolved.getConfiguredCorsOrigins
    ? resolved.getConfiguredCorsOrigins()
    : parseConfiguredCorsOrigins();

  const preflight = extensionCorsPreflightResponse(request, configuredOrigins);
  if (preflight) {
    return { kind: "preflight", response: preflight };
  }

  const context = await authenticateAdminExtension(request, deps);
  return { kind: "authenticated", context };
}
