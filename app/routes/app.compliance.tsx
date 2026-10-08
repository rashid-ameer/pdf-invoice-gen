/**
 * Group 16 — Compliance page (old /app/compliance Polaris port).
 */
import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  connectStoreAsp,
  disconnectStoreAsp,
  getCompliancePageData,
  setInvoiceMode,
  type ComplianceCheckItem,
} from "../models/compliance.server";
import { authenticate } from "../shopify.server";

const LAYOUT_COLS = "@container (inline-size > 900px) 1.4fr 0.9fr, 1fr";
const MODE_COLS = "@container (inline-size > 640px) 1fr 1fr, 1fr";
const META_COLS = "@container (inline-size > 480px) 1fr 1fr, 1fr";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const data = await getCompliancePageData(session.shop);
  if (!data) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }
  return { data };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();

  if (intent === "connect") {
    const result = await connectStoreAsp(session.shop, {
      apiKey: String(formData.get("apiKey") ?? ""),
      participantId: String(formData.get("participantId") ?? "") || undefined,
    });
    if (!result.ok) {
      return { ok: false as const, intent, error: result.error };
    }
    return {
      ok: true as const,
      intent,
      message: "ASP connected successfully.",
    };
  }

  if (intent === "disconnect") {
    const result = await disconnectStoreAsp(session.shop);
    if (!result.ok) {
      return { ok: false as const, intent, error: result.error };
    }
    return { ok: true as const, intent, message: "ASP disconnected." };
  }

  if (intent === "compliance") {
    const result = await setInvoiceMode(session.shop, "compliance");
    if (!result.ok) {
      return { ok: false as const, intent, error: result.error };
    }
    return {
      ok: true as const,
      intent,
      message:
        "Compliance mode enabled. New invoices will use compliance strict templates.",
    };
  }

  if (intent === "standard") {
    const result = await setInvoiceMode(session.shop, "standard");
    if (!result.ok) {
      return { ok: false as const, intent, error: result.error };
    }
    return {
      ok: true as const,
      intent,
      message: "Standard mode enabled.",
    };
  }

  return { ok: false as const, intent: "unknown", error: "Unknown action." };
};

function CheckRow({ item }: { item: ComplianceCheckItem }) {
  const fixHref =
    !item.ok && item.key !== "aspConnected"
      ? "/app/settings/company"
      : !item.ok && item.key === "aspConnected"
        ? "#asp-connect"
        : null;

  return (
    <s-box
      padding="small"
      borderRadius="base"
      background={item.ok ? "subdued" : "transparent"}
      border="base"
    >
      <s-stack direction="inline" gap="small" alignItems="start">
        <s-badge tone={item.ok ? "success" : "caution"}>
          {item.ok ? "Done" : "Needed"}
        </s-badge>
        <s-stack gap="small-200">
          <s-text type="strong">{item.label}</s-text>
          <s-text color="subdued">{item.detail}</s-text>
          {fixHref ? (
            <s-link href={fixHref}>
              {item.key === "aspConnected" ? "Connect below" : "Fix in Setup"}
            </s-link>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export default function CompliancePage() {
  const { data } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const toasted = useRef(false);
  const [apiKey, setApiKey] = useState("");
  const [participantId, setParticipantId] = useState(
    data.asp.participantId || data.legalEntity?.tin || "",
  );

  const busy = navigation.state !== "idle";
  const isCompliance = data.invoiceMode === "compliance";
  const canEnable = data.readiness.ready && !isCompliance;

  useEffect(() => {
    setParticipantId(data.asp.participantId || data.legalEntity?.tin || "");
  }, [data.asp.participantId, data.legalEntity?.tin]);

  useEffect(() => {
    if (toasted.current) return;
    const saved = searchParams.get("saved") === "1";
    const message = searchParams.get("message");
    if (saved || message) {
      toasted.current = true;
      shopify.toast.show(message || "Settings saved.");
      const next = new URLSearchParams(searchParams);
      next.delete("saved");
      next.delete("message");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, shopify]);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok && "message" in actionData && actionData.message) {
      shopify.toast.show(actionData.message);
      setApiKey("");
    }
  }, [actionData, shopify]);

  const errorMessage =
    actionData && !actionData.ok && "error" in actionData
      ? actionData.error
      : null;

  const connectedAtLabel = data.asp.connectedAt
    ? new Date(data.asp.connectedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <s-page heading="Compliance">
      <s-stack gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text color="subdued">
            Choose Standard PDF invoicing or Compliance mode for structured
            e-invoices and ASP submission.
          </s-text>
          <s-badge tone={isCompliance ? "success" : "info"}>
            {isCompliance ? "Compliance mode" : "Standard mode"}
          </s-badge>
        </s-stack>

        {errorMessage ? (
          <s-banner tone="critical" heading="Couldn't update compliance">
            {errorMessage}
          </s-banner>
        ) : null}

        <s-query-container>
          <s-grid gridTemplateColumns={LAYOUT_COLS} gap="base">
            <s-stack gap="base">
              <s-section heading="Invoice mode">
                <s-stack gap="base">
                  <s-text color="subdued">
                    Controls PDF layout strictness and whether new invoices are
                    queued for ASP submission.
                  </s-text>
                  <s-query-container>
                    <s-grid gridTemplateColumns={MODE_COLS} gap="base">
                      <s-box
                        padding="base"
                        border="base"
                        borderRadius="base"
                        background={!isCompliance ? "subdued" : "transparent"}
                      >
                        <s-stack gap="small">
                          <s-heading>Standard</s-heading>
                          <s-text color="subdued">
                            Branded PDF tax invoices from Shopify orders. Full
                            template customization (SKU, images, discounts).
                          </s-text>
                          <s-unordered-list>
                            <s-list-item>
                              PDF download &amp; email delivery
                            </s-list-item>
                            <s-list-item>Flexible template columns</s-list-item>
                            <s-list-item>No ASP submission</s-list-item>
                          </s-unordered-list>
                          {isCompliance ? (
                            <Form method="post">
                              <input type="hidden" name="intent" value="standard" />
                              <s-button
                                type="submit"
                                variant="secondary"
                                {...(busy ? { loading: true, disabled: true } : {})}
                              >
                                Switch to Standard
                              </s-button>
                            </Form>
                          ) : (
                            <s-badge tone="info">Current mode</s-badge>
                          )}
                        </s-stack>
                      </s-box>

                      <s-box
                        padding="base"
                        border="base"
                        borderRadius="base"
                        background={isCompliance ? "subdued" : "transparent"}
                      >
                        <s-stack gap="small">
                          <s-heading>Compliance</s-heading>
                          <s-text color="subdued">
                            E-invoicing–aligned PDFs with mandatory fields, tax
                            breakdown, and ASP submission when live.
                          </s-text>
                          <s-unordered-list>
                            <s-list-item>
                              Strict seller TRN / TIN / contact fields
                            </s-list-item>
                            <s-list-item>
                              VAT amount per line, no merchandising columns
                            </s-list-item>
                            <s-list-item>
                              ASP submission pipeline (Phase 2)
                            </s-list-item>
                          </s-unordered-list>
                          {isCompliance ? (
                            <s-badge tone="success">Current mode</s-badge>
                          ) : (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="compliance"
                              />
                              <s-button
                                type="submit"
                                variant="primary"
                                {...(canEnable
                                  ? busy
                                    ? { loading: true, disabled: true }
                                    : {}
                                  : {
                                      disabled: true,
                                      interestFor: "enable-compliance-tip",
                                    })}
                              >
                                Enable compliance mode
                              </s-button>
                            </Form>
                          )}
                        </s-stack>
                      </s-box>
                    </s-grid>
                  </s-query-container>
                </s-stack>
              </s-section>

              <s-section heading="ASP connection" id="asp-connect">
                <s-stack gap="base">
                  <s-text color="subdued">
                    Link your Accredited Service Provider (Storecove) before
                    enabling compliance mode.
                  </s-text>

                  {data.asp.connected ? (
                    <s-stack gap="base">
                      <s-badge tone="success">
                        Connected to {data.asp.providerName}
                      </s-badge>
                      <s-query-container>
                        <s-grid gridTemplateColumns={META_COLS} gap="base">
                          <s-stack gap="small-200">
                            <s-text color="subdued">Provider</s-text>
                            <s-text>{data.asp.providerName}</s-text>
                          </s-stack>
                          <s-stack gap="small-200">
                            <s-text color="subdued">Participant ID</s-text>
                            <s-text>{data.asp.participantId}</s-text>
                          </s-stack>
                          <s-stack gap="small-200">
                            <s-text color="subdued">Status</s-text>
                            <s-text>{data.asp.status}</s-text>
                          </s-stack>
                          {connectedAtLabel ? (
                            <s-stack gap="small-200">
                              <s-text color="subdued">Connected</s-text>
                              <s-text>{connectedAtLabel}</s-text>
                            </s-stack>
                          ) : null}
                        </s-grid>
                      </s-query-container>
                      <Form method="post">
                        <input type="hidden" name="intent" value="disconnect" />
                        <s-button
                          type="submit"
                          variant="secondary"
                          tone="critical"
                          {...(isCompliance
                            ? {
                                disabled: true,
                                interestFor: "disconnect-asp-tip",
                              }
                            : busy
                              ? { loading: true, disabled: true }
                              : {})}
                        >
                          Disconnect ASP
                        </s-button>
                      </Form>
                    </s-stack>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="connect" />
                      <s-stack gap="base">
                        <s-password-field
                          label="Storecove API key"
                          name="apiKey"
                          required
                          autocomplete="off"
                          placeholder="Paste your ASP API key"
                          value={apiKey}
                          onInput={(event: Event) => {
                            setApiKey(
                              (event.currentTarget as HTMLInputElement).value,
                            );
                          }}
                          details="From your Storecove dashboard. Stored securely and never shown again."
                        />
                        <s-text-field
                          label="Participant ID (TIN)"
                          name="participantId"
                          value={participantId}
                          placeholder="Your electronic invoicing participant ID"
                          details="Defaults to the TIN from Setup. Used as seller electronic address."
                          onInput={(event: Event) => {
                            setParticipantId(
                              (event.currentTarget as HTMLInputElement).value,
                            );
                          }}
                        />
                        <s-button
                          type="submit"
                          variant="primary"
                          {...(busy ? { loading: true, disabled: true } : {})}
                        >
                          Connect ASP
                        </s-button>
                      </s-stack>
                    </Form>
                  )}
                </s-stack>
              </s-section>
            </s-stack>

            <s-stack gap="base">
              <s-section heading="Readiness">
                <s-stack gap="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text color="subdued">
                      {data.readiness.score}% complete
                    </s-text>
                    <s-badge
                      tone={data.readiness.ready ? "success" : "caution"}
                    >
                      {data.readiness.score}%
                    </s-badge>
                  </s-stack>
                  <s-stack gap="small">
                    {data.readiness.checks.map((item) => (
                      <CheckRow key={item.key} item={item} />
                    ))}
                  </s-stack>
                </s-stack>
              </s-section>

              <s-section heading="What changes in compliance mode?">
                <s-unordered-list>
                  <s-list-item>
                    New invoices snapshot compliance mode and structured
                    e-invoice metadata.
                  </s-list-item>
                  <s-list-item>
                    Templates use strict compliance invoice columns (no
                    SKU/barcode/images).
                  </s-list-item>
                  <s-list-item>
                    Existing invoices keep the mode they were created with.
                  </s-list-item>
                  <s-list-item>
                    ASP submission runs when the Storecove adapter is enabled
                    server-side.
                  </s-list-item>
                </s-unordered-list>
              </s-section>
            </s-stack>
          </s-grid>
        </s-query-container>
      </s-stack>

      <s-tooltip id="enable-compliance-tip">
        <s-text>Complete readiness checklist first</s-text>
      </s-tooltip>
      <s-tooltip id="disconnect-asp-tip">
        <s-text>Switch to Standard mode first</s-text>
      </s-tooltip>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
