export type ReregisterWebhooksResult =
  | {
      ok: true;
      message: string;
      needsReauth: false;
      failures: Array<{ topic: string; error: unknown }>;
    }
  | {
      ok: false;
      error: string;
      message?: string;
      needsReauth: boolean;
      failures?: Array<{ topic: string; error: unknown }>;
    };

export type WebhookRegisterDeps = {
  getAdminSession: (
    shopDomain: string,
  ) => Promise<{ session: { accessToken?: string | null } | null }>;
  registerWebhooks: (args: {
    session: { accessToken?: string | null };
  }) => Promise<
    | Record<string, Array<{ success?: boolean; result?: unknown }>>
    | null
    | undefined
    | void
  >;
};

const REAUTH_HINT =
  "Shopify access token is invalid or expired. Re-authorize the app so webhooks can be registered.";

async function defaultDeps(): Promise<WebhookRegisterDeps> {
  const shopify = await import("../shopify.server");
  return {
    getAdminSession: (shopDomain) => shopify.unauthenticated.admin(shopDomain),
    registerWebhooks: (args) =>
      shopify.registerWebhooks({ session: args.session as never }),
  };
}

/**
 * Re-register app webhook subscriptions for a shop using the React Router
 * Shopify app helper (reads topics/URIs from shopify.app.toml).
 *
 * Does NOT register the old monolithic `/webhooks/shopify` endpoint.
 * Topics: app/uninstalled, app/scopes_update, orders/create, orders/paid.
 */
export async function reregisterWebhooksForShop(
  shopDomain: string,
  deps?: WebhookRegisterDeps,
): Promise<ReregisterWebhooksResult> {
  try {
    const resolved = deps ?? (await defaultDeps());
    const { session } = await resolved.getAdminSession(shopDomain);
    if (!session?.accessToken) {
      return {
        ok: false,
        error: "Shopify session missing. Re-authorize the app.",
        needsReauth: true,
      };
    }

    const result = await resolved.registerWebhooks({ session });
    const failures = Object.entries(result ?? {}).flatMap(([topic, entries]) =>
      (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && entry.success === false)
        .map((entry) => ({
          topic,
          error: entry.result ?? "registration failed",
        })),
    );

    if (failures.length > 0) {
      return {
        ok: false,
        error:
          "Some webhook registrations failed. Check APP_URL is publicly reachable over HTTPS.",
        message:
          "Some webhook registrations failed. Check APP_URL is publicly reachable over HTTPS.",
        needsReauth: false,
        failures,
      };
    }

    return {
      ok: true,
      needsReauth: false,
      failures: [],
      message:
        "Webhooks registered (orders/create, orders/paid, app/uninstalled, app/scopes_update).",
    };
  } catch (error) {
    console.error("[webhooks] re-register error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const needsReauth =
      /401|403|Unauthorized|Forbidden|session|token/i.test(message) ||
      /Could not find a session/i.test(message);
    return {
      ok: false,
      error: needsReauth ? REAUTH_HINT : message,
      needsReauth,
    };
  }
}
