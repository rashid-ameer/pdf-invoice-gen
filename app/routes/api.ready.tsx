/**
 * GET /api/ready — public readiness (database only; Group 17 Phase 4).
 * No Shopify session or App Home auth required.
 */
import { getReadyPayload, jsonResponse } from "../models/health.server";

export const loader = async () => {
  const { status, body } = await getReadyPayload();
  return jsonResponse(status, body);
};
