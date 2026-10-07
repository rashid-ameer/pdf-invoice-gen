/**
 * GET /api/health — public liveness/dependency health (Group 17 Phase 4).
 * No Shopify session or App Home auth required.
 */
import { getHealthPayload, jsonResponse } from "../models/health.server";

export const loader = async () => {
  const { status, body } = await getHealthPayload();
  return jsonResponse(status, body);
};
