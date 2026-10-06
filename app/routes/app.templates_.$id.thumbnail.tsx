import type { LoaderFunctionArgs } from "react-router";

import { getTemplateByIdForShop } from "../models/template.server";
import { getTemplateThumbnailJpeg } from "../models/template-thumbnail.server";
import { authenticate } from "../shopify.server";

/**
 * GET /app/templates/:id/thumbnail
 * Old parity: session-scoped JPEG (or 404). Cache-Control private, max-age=120.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const templateId = String(params.id ?? "").trim();
  if (!templateId) {
    return new Response("Template not found", { status: 404 });
  }

  const allowed = await getTemplateByIdForShop(session.shop, templateId);
  if (!allowed) {
    return new Response("Template not found", { status: 404 });
  }

  try {
    const jpeg = await getTemplateThumbnailJpeg(session.shop, templateId);
    if (!jpeg) {
      return new Response("Thumbnail not available", { status: 404 });
    }

    return new Response(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (error) {
    console.error("[templates] thumbnail error:", error);
    return new Response("Failed to render thumbnail", { status: 500 });
  }
};
