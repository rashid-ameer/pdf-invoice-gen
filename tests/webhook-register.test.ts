import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reregisterWebhooksForShop,
  type WebhookRegisterDeps,
} from "../app/models/webhook-register.server";

describe("reregisterWebhooksForShop", () => {
  it("returns needsReauth when the admin session has no access token", async () => {
    const deps: WebhookRegisterDeps = {
      getAdminSession: async () => ({ session: { accessToken: null } }),
      registerWebhooks: async () => {
        throw new Error("registerWebhooks should not be called");
      },
    };

    const result = await reregisterWebhooksForShop("shop.myshopify.com", deps);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.needsReauth, true);
      assert.match(result.error, /session|re-authorize|authorize/i);
    }
  });

  it("returns ok when all topic registrations succeed", async () => {
    const deps: WebhookRegisterDeps = {
      getAdminSession: async () => ({
        session: { accessToken: "shpat_test" },
      }),
      registerWebhooks: async () => ({
        ORDERS_CREATE: [{ success: true }],
        ORDERS_PAID: [{ success: true }],
      }),
    };

    const result = await reregisterWebhooksForShop("shop.myshopify.com", deps);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.needsReauth, false);
      assert.equal(result.failures.length, 0);
      assert.match(result.message, /orders\/create/i);
    }
  });

  it("returns failure details when a topic registration fails", async () => {
    const deps: WebhookRegisterDeps = {
      getAdminSession: async () => ({
        session: { accessToken: "shpat_test" },
      }),
      registerWebhooks: async () => ({
        ORDERS_CREATE: [{ success: true }],
        ORDERS_PAID: [
          { success: false, result: { message: "callback URL unreachable" } },
        ],
      }),
    };

    const result = await reregisterWebhooksForShop("shop.myshopify.com", deps);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.needsReauth, false);
      assert.equal(result.failures?.length, 1);
      assert.equal(result.failures?.[0]?.topic, "ORDERS_PAID");
      assert.match(result.error, /APP_URL|HTTPS|failed/i);
    }
  });

  it("maps session-not-found errors to needsReauth", async () => {
    const deps: WebhookRegisterDeps = {
      getAdminSession: async () => {
        throw new Error("Could not find a session for shop.myshopify.com");
      },
      registerWebhooks: async () => ({}),
    };

    const result = await reregisterWebhooksForShop("shop.myshopify.com", deps);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.needsReauth, true);
    }
  });
});
