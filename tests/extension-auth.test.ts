/**
 * Group 15 Phase A — Admin UI extension auth + CORS unit tests.
 * No live Shopify calls; decode / offline session are stubbed.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  EXTENSION_CORS_ALLOW_HEADERS,
  EXTENSION_CORS_ALLOW_METHODS,
  EXTENSION_ORIGIN,
  authenticateAdminExtension,
  buildExtensionCorsHeaders,
  extensionCorsPreflightResponse,
  extractExtensionSessionToken,
  isShopifyExtensionOrigin,
  parseConfiguredCorsOrigins,
  requireAdminExtensionAuth,
  type ExtensionAuthDeps,
  type ExtensionOfflineSession,
} from "../app/models/extension-auth.server";

const SHOP = "test-shop.myshopify.com";

function offlineSession(
  overrides: Partial<ExtensionOfflineSession> = {},
): ExtensionOfflineSession {
  return {
    id: `offline_${SHOP}`,
    shop: SHOP,
    accessToken: "shpat_test",
    isOnline: false,
    ...overrides,
  };
}

function stubDeps(
  overrides: Partial<ExtensionAuthDeps> = {},
): ExtensionAuthDeps {
  return {
    decodeSessionToken: async () => ({ dest: `https://${SHOP}` }),
    sanitizeShop: (shop) =>
      shop === SHOP || shop.endsWith(".myshopify.com") ? shop.toLowerCase() : null,
    loadOfflineSession: async () => offlineSession(),
    getConfiguredCorsOrigins: () => [],
    ...overrides,
  };
}

function request(
  url: string,
  init: RequestInit & { origin?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("Origin", init.origin);
  return new Request(url, { ...init, headers });
}

async function expectUnauthorized(fn: () => Promise<unknown>) {
  try {
    await fn();
    assert.fail("expected 401 Response");
  } catch (error) {
    assert.ok(error instanceof Response, "should throw Response");
    assert.equal(error.status, 401);
    const body = (await error.json()) as { error?: string };
    assert.equal(typeof body.error, "string");
    assert.ok(!("detail" in body));
    assert.ok(!("stack" in body));
    return error;
  }
}

describe("parseConfiguredCorsOrigins", () => {
  it("parses comma-separated origins and ignores empties", () => {
    assert.deepEqual(parseConfiguredCorsOrigins(undefined), []);
    assert.deepEqual(parseConfiguredCorsOrigins(""), []);
    assert.deepEqual(parseConfiguredCorsOrigins("  ,  "), []);
    assert.deepEqual(
      parseConfiguredCorsOrigins(
        " https://a.example.com ,https://b.example.com, ",
      ),
      ["https://a.example.com", "https://b.example.com"],
    );
  });
});

describe("isShopifyExtensionOrigin", () => {
  it("allows admin.shopify.com", () => {
    assert.equal(
      isShopifyExtensionOrigin("https://admin.shopify.com", []),
      true,
    );
  });

  it("allows *.myshopify.com", () => {
    assert.equal(
      isShopifyExtensionOrigin("https://cool-store.myshopify.com", []),
      true,
    );
  });

  it("allows configured EXTENSIONS_CORS_ORIGINS", () => {
    assert.equal(
      isShopifyExtensionOrigin("https://custom-tunnel.example", [
        "https://custom-tunnel.example",
      ]),
      true,
    );
  });

  it("rejects unknown origins", () => {
    assert.equal(isShopifyExtensionOrigin("https://evil.example", []), false);
    assert.equal(isShopifyExtensionOrigin("", []), false);
  });

  it("allows Shopify CDN / cloud origins (old parity)", () => {
    assert.equal(isShopifyExtensionOrigin(EXTENSION_ORIGIN, []), true);
    assert.equal(
      isShopifyExtensionOrigin("https://foo.shopifycloud.com", []),
      true,
    );
  });
});

describe("CORS headers", () => {
  it("echoes only the allowed request origin", () => {
    const headers = buildExtensionCorsHeaders(
      request("https://app.example/app/print", {
        origin: "https://admin.shopify.com",
      }),
      [],
    );
    assert.equal(
      headers.get("Access-Control-Allow-Origin"),
      "https://admin.shopify.com",
    );
    assert.equal(headers.get("Access-Control-Allow-Credentials"), "true");
    assert.equal(
      headers.get("Access-Control-Allow-Methods"),
      EXTENSION_CORS_ALLOW_METHODS,
    );
    const allowHeaders = headers.get("Access-Control-Allow-Headers") || "";
    assert.ok(allowHeaders.includes("Authorization"));
    assert.ok(allowHeaders.includes("Content-Type"));
  });

  it("does not allow unknown origins", () => {
    const headers = buildExtensionCorsHeaders(
      request("https://app.example/app/print", {
        origin: "https://attacker.example",
      }),
      [],
    );
    assert.equal(headers.get("Access-Control-Allow-Origin"), null);
  });

  it("allows configured EXTENSIONS_CORS_ORIGINS origin", () => {
    const configured = ["https://ngrok.example"];
    const headers = buildExtensionCorsHeaders(
      request("https://app.example/api", { origin: "https://ngrok.example" }),
      configured,
    );
    assert.equal(
      headers.get("Access-Control-Allow-Origin"),
      "https://ngrok.example",
    );
  });

  it("OPTIONS returns 204 without authentication", async () => {
    const response = extensionCorsPreflightResponse(
      request("https://app.example/app/print", {
        method: "OPTIONS",
        origin: "https://admin.shopify.com",
      }),
      [],
    );
    assert.ok(response);
    assert.equal(response!.status, 204);
    assert.equal(
      response!.headers.get("Access-Control-Allow-Origin"),
      "https://admin.shopify.com",
    );

    const result = await requireAdminExtensionAuth(
      request("https://app.example/app/print", {
        method: "OPTIONS",
        origin: "https://store.myshopify.com",
      }),
      stubDeps({
        decodeSessionToken: async () => {
          throw new Error("should not decode on OPTIONS");
        },
        loadOfflineSession: async () => {
          throw new Error("should not load session on OPTIONS");
        },
      }),
    );
    assert.equal(result.kind, "preflight");
    if (result.kind === "preflight") {
      assert.equal(result.response.status, 204);
    }
  });
});

describe("extractExtensionSessionToken", () => {
  it("reads Bearer token", () => {
    const token = extractExtensionSessionToken(
      request("https://app.example/api", {
        headers: { Authorization: "Bearer abc.def.ghi" },
      }),
    );
    assert.equal(token, "abc.def.ghi");
  });

  it("reads ?token=", () => {
    const token = extractExtensionSessionToken(
      request("https://app.example/app/print?token=abc.def.ghi"),
    );
    assert.equal(token, "abc.def.ghi");
  });

  it("treats malformed Bearer as missing token for empty value", () => {
    const token = extractExtensionSessionToken(
      request("https://app.example/api", {
        headers: { Authorization: "Bearer " },
      }),
    );
    assert.equal(token, undefined);
  });
});

describe("authenticateAdminExtension", () => {
  afterEach(() => {
    // no shared mutable env required
  });

  it("accepts a valid Bearer token", async () => {
    const ctx = await authenticateAdminExtension(
      request("https://app.example/api/orders/1/documents", {
        headers: { Authorization: "Bearer valid.jwt.token" },
        origin: "https://admin.shopify.com",
      }),
      stubDeps(),
    );
    assert.equal(ctx.shop, SHOP);
    assert.equal(ctx.session.accessToken, "shpat_test");
    assert.equal(
      ctx.corsHeaders.get("Access-Control-Allow-Origin"),
      "https://admin.shopify.com",
    );
  });

  it("accepts a valid ?token= query token", async () => {
    const ctx = await authenticateAdminExtension(
      request(`https://app.example/app/print?token=valid.jwt.token`, {
        origin: "https://cool-store.myshopify.com",
      }),
      stubDeps(),
    );
    assert.equal(ctx.shop, SHOP);
  });

  it("returns 401 when Authorization and query token are missing", async () => {
    await expectUnauthorized(() =>
      authenticateAdminExtension(
        request("https://app.example/api/orders/1/documents"),
        stubDeps(),
      ),
    );
  });

  it("returns 401 for malformed Bearer header (non-JWT)", async () => {
    await expectUnauthorized(() =>
      authenticateAdminExtension(
        request("https://app.example/api", {
          headers: { Authorization: "Bearer not-a-jwt" },
        }),
        stubDeps({
          decodeSessionToken: async () => {
            throw new Error("invalid");
          },
        }),
      ),
    );
  });

  it("returns 401 for invalid JWT", async () => {
    await expectUnauthorized(() =>
      authenticateAdminExtension(
        request("https://app.example/api", {
          headers: { Authorization: "Bearer a.b.c" },
        }),
        stubDeps({
          decodeSessionToken: async () => {
            throw new Error("JwtExpiredError");
          },
        }),
      ),
    );
  });

  it("returns 401 when offline session is missing", async () => {
    await expectUnauthorized(() =>
      authenticateAdminExtension(
        request("https://app.example/api", {
          headers: { Authorization: "Bearer a.b.c" },
        }),
        stubDeps({
          loadOfflineSession: async () => null,
        }),
      ),
    );
  });

  it("takes shop from the validated token dest", async () => {
    const other = "other-shop.myshopify.com";
    const ctx = await authenticateAdminExtension(
      request("https://app.example/api", {
        headers: { Authorization: "Bearer a.b.c" },
      }),
      stubDeps({
        decodeSessionToken: async () => ({ dest: `https://${other}` }),
        sanitizeShop: (shop) => (shop === other ? other : null),
        loadOfflineSession: async (shop) => {
          assert.equal(shop, other);
          return offlineSession({ id: `offline_${other}`, shop: other });
        },
      }),
    );
    assert.equal(ctx.shop, other);
  });

  it("ignores client-supplied shop and uses token shop", async () => {
    const calls: string[] = [];
    const ctx = await authenticateAdminExtension(
      request(
        "https://app.example/api?shop=attacker.myshopify.com&token=a.b.c",
      ),
      stubDeps({
        decodeSessionToken: async () => ({ dest: `https://${SHOP}` }),
        loadOfflineSession: async (shop) => {
          calls.push(shop);
          return offlineSession();
        },
      }),
    );
    assert.equal(ctx.shop, SHOP);
    assert.deepEqual(calls, [SHOP]);
    assert.notEqual(ctx.shop, "attacker.myshopify.com");
  });

  it("requireAdminExtensionAuth returns authenticated context", async () => {
    const result = await requireAdminExtensionAuth(
      request("https://app.example/api", {
        headers: { Authorization: "Bearer a.b.c" },
      }),
      stubDeps(),
    );
    assert.equal(result.kind, "authenticated");
    if (result.kind === "authenticated") {
      assert.equal(result.context.shop, SHOP);
    }
  });
});
