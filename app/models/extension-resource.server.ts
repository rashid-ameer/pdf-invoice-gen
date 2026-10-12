/**
 * Shared wiring for Group 15 extension resource routes:
 * OPTIONS preflight → Phase A auth → handler → CORS on response.
 */
import type { ExtensionAuthDeps } from "./extension-auth.server";
import {
  requireAdminExtensionAuth,
  withExtensionCors,
  type AdminExtensionAuthContext,
} from "./extension-auth.server";

export async function handleExtensionResource(
  request: Request,
  handler: (ctx: AdminExtensionAuthContext) => Promise<Response>,
  deps?: Partial<ExtensionAuthDeps>,
): Promise<Response> {
  try {
    const auth = await requireAdminExtensionAuth(request, deps);
    if (auth.kind === "preflight") return auth.response;

    const response = await handler(auth.context);
    return withExtensionCors(request, response);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[extension-resource] unexpected error:", error);
    return withExtensionCors(
      request,
      new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
    );
  }
}

export function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Binary image response for Admin extension inline previews. */
export function binaryResponse(
  body: Buffer | Uint8Array,
  contentType: string,
  status = 200,
  cacheControl = "private, max-age=300",
): Response {
  const bytes = body instanceof Buffer ? new Uint8Array(body) : body;
  return new Response(bytes, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    },
  });
}
