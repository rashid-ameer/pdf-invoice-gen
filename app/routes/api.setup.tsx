/**
 * GET /api/setup — non-production Partner Dashboard diagnostics (Group 17 Phase 4).
 * Production returns 404. No Shopify session or App Home auth required.
 */
import { getSetupPayload, jsonResponse } from "../models/health.server";

export const loader = async () => {
  const { status, body } = getSetupPayload();
  return jsonResponse(status, body);
};
