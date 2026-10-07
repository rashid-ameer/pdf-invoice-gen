/**
 * Group 17 Phase 4 — /api/health, /api/ready, /api/setup
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getHealthPayload,
  getReadyPayload,
  getSetupPayload,
  setDatabaseHealthCheckForTests,
} from "../app/models/health.server";
import { loader as healthLoader } from "../app/routes/api.health";
import { loader as readyLoader } from "../app/routes/api.ready";
import { loader as setupLoader } from "../app/routes/api.setup";

const SECRET = "shopify-secret-value-must-never-leak";
const API_KEY = "shopify-api-key-must-never-leak";

const ENV_KEYS = [
  "NODE_ENV",
  "SHOPIFY_APP_URL",
  "APP_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SCOPES",
  "VERCEL_URL",
] as const;

const originalEnv: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  setDatabaseHealthCheckForTests(null);
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function routeSource(name: string): string {
  return readFileSync(join(process.cwd(), "app/routes", name), "utf8");
}

function assertNoSecrets(payload: unknown) {
  const raw = JSON.stringify(payload);
  assert.doesNotMatch(raw, new RegExp(SECRET));
  assert.doesNotMatch(raw, new RegExp(API_KEY));
  assert.doesNotMatch(raw, /DATABASE_URL|postgresql:\/\/|file:.*\.sqlite/i);
  assert.doesNotMatch(raw, /accessToken|apiSecret(?!Configured)|password/i);
}

describe("Group 17 Phase 4 — /api/health", () => {
  it("returns 200 ok when database is healthy; redis disabled", async () => {
    setDatabaseHealthCheckForTests(async () => ({
      connected: true,
      status: "connected",
    }));

    const { status, body } = await getHealthPayload();
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.services.database.connected, true);
    assert.equal(body.services.database.status, "connected");
    assert.equal(body.services.redis.connected, false);
    assert.equal(body.services.redis.status, "disabled");
    assert.ok(body.timestamp);
    assertNoSecrets(body);

    const res = await healthLoader();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Type") ?? "", /application\/json/);
  });

  it("returns 503 degraded when database is unhealthy; redis still disabled", async () => {
    setDatabaseHealthCheckForTests(async () => ({
      connected: false,
      status: "disconnected",
    }));

    const { status, body } = await getHealthPayload();
    assert.equal(status, 503);
    assert.equal(body.status, "degraded");
    assert.equal(body.services.database.connected, false);
    assert.equal(body.services.database.status, "disconnected");
    assert.equal(body.services.redis.status, "disabled");
    assertNoSecrets(body);
  });

  it("route does not import Shopify authenticate helpers", () => {
    const src = routeSource("api.health.tsx");
    assert.doesNotMatch(src, /from ["'].*shopify\.server["']/);
    assert.doesNotMatch(src, /\bauthenticate\b/);
  });
});

describe("Group 17 Phase 4 — /api/ready", () => {
  it("returns 200 ready=true when database is healthy", async () => {
    setDatabaseHealthCheckForTests(async () => ({
      connected: true,
      status: "connected",
    }));

    const { status, body } = await getReadyPayload();
    assert.equal(status, 200);
    assert.equal(body.ready, true);

    const res = await readyLoader();
    assert.equal(res.status, 200);
  });

  it("returns 503 ready=false when database is unhealthy", async () => {
    setDatabaseHealthCheckForTests(async () => ({
      connected: false,
      status: "disconnected",
    }));

    const { status, body } = await getReadyPayload();
    assert.equal(status, 503);
    assert.equal(body.ready, false);
  });

  it("redis does not affect readiness (always disabled in payload path)", async () => {
    setDatabaseHealthCheckForTests(async () => ({
      connected: true,
      status: "connected",
    }));
    const healthy = await getReadyPayload();
    assert.equal(healthy.body.ready, true);

    setDatabaseHealthCheckForTests(async () => ({
      connected: false,
      status: "disconnected",
    }));
    const unhealthy = await getReadyPayload();
    assert.equal(unhealthy.body.ready, false);
    // Redis is never consulted — readiness flips solely with DB mock.
  });

  it("route does not import Shopify authenticate helpers", () => {
    const src = routeSource("api.ready.tsx");
    assert.doesNotMatch(src, /from ["'].*shopify\.server["']/);
    assert.doesNotMatch(src, /\bauthenticate\b/);
  });
});

describe("Group 17 Phase 4 — /api/setup", () => {
  it("non-production returns setup diagnostics with boolean secret flags", () => {
    process.env.NODE_ENV = "development";
    process.env.SHOPIFY_APP_URL = "https://example-app.test";
    process.env.SHOPIFY_API_KEY = API_KEY;
    process.env.SHOPIFY_API_SECRET = SECRET;
    process.env.SCOPES = "read_orders, write_products";
    process.env.VERCEL_URL = "example.vercel.app";

    const result = getSetupPayload();
    assert.equal(result.status, 200);
    assert.ok(result.status === 200);
    const body = result.body;
    assert.equal(body.appUrl, "https://example-app.test");
    assert.equal(body.embeddedAppUrl, "https://example-app.test/app");
    assert.equal(body.authCallbackUrl, "https://example-app.test/auth/callback");
    assert.equal(body.privacyUrl, "https://example-app.test/privacy");
    assert.equal(body.supportUrl, "https://example-app.test/support");
    assert.equal(body.shopifyApiKeyConfigured, true);
    assert.equal(body.shopifyApiSecretConfigured, true);
    assert.deepEqual(body.scopes, ["read_orders", "write_products"]);
    assert.equal(body.redisEnabled, false);
    assert.equal(body.vercelUrl, "example.vercel.app");
    assert.equal(body.nodeEnv, "development");
    assert.ok(Array.isArray(body.shopifyDevDashboardSteps));
    assert.ok(body.shopifyDevDashboardSteps.length >= 1);
    assertNoSecrets(body);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, "shopifyApiSecret"),
      false,
    );
  });

  it("production returns 404 Not found", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHOPIFY_API_SECRET = SECRET;

    const result = getSetupPayload();
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "Not found" });
    assertNoSecrets(result.body);

    const res = await setupLoader();
    assert.equal(res.status, 404);
  });

  it("reports configured=false when keys are missing", () => {
    process.env.NODE_ENV = "test";
    process.env.SHOPIFY_APP_URL = "https://app.test";
    delete process.env.SHOPIFY_API_KEY;
    delete process.env.SHOPIFY_API_SECRET;
    process.env.SCOPES = "";

    const result = getSetupPayload();
    assert.equal(result.status, 200);
    assert.ok(result.status === 200);
    assert.equal(result.body.shopifyApiKeyConfigured, false);
    assert.equal(result.body.shopifyApiSecretConfigured, false);
    assert.deepEqual(result.body.scopes, []);
    assert.equal(result.body.redisEnabled, false);
  });

  it("route does not import Shopify authenticate helpers", () => {
    const src = routeSource("api.setup.tsx");
    assert.doesNotMatch(src, /from ["'].*shopify\.server["']/);
    assert.doesNotMatch(src, /\bauthenticate\b/);
  });
});
