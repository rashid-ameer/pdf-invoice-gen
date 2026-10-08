/**
 * Group 17 Phase 4 — /api/health, /api/ready, /api/setup
 * Old health.routes.ts parity with Prisma instead of Mongo; Redis always disabled.
 */

import prisma from "../db.server";
import { getPublicAppUrl } from "../constants/app.server";

export type DatabaseHealth = {
  connected: boolean;
  status: "connected" | "disconnected";
};

export type RedisHealth = {
  connected: false;
  status: "disabled";
};

const DISABLED_REDIS: RedisHealth = {
  connected: false,
  status: "disabled",
};

async function checkDatabaseHealthDefault(): Promise<DatabaseHealth> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true, status: "connected" };
  } catch {
    return { connected: false, status: "disconnected" };
  }
}

let checkDatabaseHealthImpl: () => Promise<DatabaseHealth> =
  checkDatabaseHealthDefault;

/** Test hook — restores real Prisma check when passed null. */
export function setDatabaseHealthCheckForTests(
  fn: (() => Promise<DatabaseHealth>) | null,
): void {
  checkDatabaseHealthImpl = fn ?? checkDatabaseHealthDefault;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  return checkDatabaseHealthImpl();
}

export type HealthPayload = {
  status: "ok" | "degraded";
  timestamp: string;
  services: {
    database: DatabaseHealth;
    redis: RedisHealth;
  };
};

export async function getHealthPayload(): Promise<{
  status: number;
  body: HealthPayload;
}> {
  const database = await checkDatabaseHealth();
  const healthy = database.connected;
  return {
    status: healthy ? 200 : 503,
    body: {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        database,
        redis: DISABLED_REDIS,
      },
    },
  };
}

export type ReadyPayload = {
  ready: boolean;
};

export async function getReadyPayload(): Promise<{
  status: number;
  body: ReadyPayload;
}> {
  const database = await checkDatabaseHealth();
  const ready = database.connected;
  return {
    status: ready ? 200 : 503,
    body: { ready },
  };
}

export type SetupPayload = {
  appUrl: string;
  embeddedAppUrl: string;
  authCallbackUrl: string;
  privacyUrl: string;
  supportUrl: string;
  shopifyApiKeyConfigured: boolean;
  shopifyApiSecretConfigured: boolean;
  scopes: string[];
  redisEnabled: false;
  vercelUrl: string | null;
  nodeEnv: string;
  shopifyDevDashboardSteps: string[];
};

export type SetupResult =
  | { status: 404; body: { error: string } }
  | { status: 200; body: SetupPayload };

function parseScopes(): string[] {
  return (process.env.SCOPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getSetupPayload(): SetupResult {
  if (isProductionEnvironment()) {
    return { status: 404, body: { error: "Not found" } };
  }

  const appUrl = getPublicAppUrl();
  return {
    status: 200,
    body: {
      appUrl,
      embeddedAppUrl: `${appUrl}/app`,
      authCallbackUrl: `${appUrl}/auth/callback`,
      privacyUrl: `${appUrl}/privacy`,
      supportUrl: `${appUrl}/support`,
      shopifyApiKeyConfigured: Boolean(process.env.SHOPIFY_API_KEY),
      shopifyApiSecretConfigured: Boolean(process.env.SHOPIFY_API_SECRET),
      scopes: parseScopes(),
      redisEnabled: false,
      vercelUrl: process.env.VERCEL_URL ?? null,
      nodeEnv: process.env.NODE_ENV ?? "development",
      shopifyDevDashboardSteps: [
        "Open https://dev.shopify.com/dashboard",
        "Select your app",
        "Open Versions",
        "Click Create version",
        "Set App URL to the embeddedAppUrl value above",
        "Add authCallbackUrl to Allowed redirection URL(s)",
        "Add privacyUrl and supportUrl to the App Store listing",
        "Save and Release the version",
      ],
    },
  };
}

export function jsonResponse(
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
