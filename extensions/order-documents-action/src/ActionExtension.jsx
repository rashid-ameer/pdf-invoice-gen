import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
  OPEN_INVOICES_HREF,
  actionSafeErrorMessage,
  buildOrderActionPrintHref,
  creditNotesLabel,
  documentsSummaryPath,
  invoiceCustomerLinkPath,
  invoiceEmailPath,
  invoicePreviewPath,
  numericOrderId,
  parseDocumentsSummary,
} from "./action-extension-logic.js";

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Order details → More actions → Tax documents
 * Thin UI over Group 15 Phase B APIs (email / customer link / preview / print URL).
 */
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { close, data, i18n } = shopify;
  const orderId = numericOrderId(data?.selected?.[0]?.id);

  const [loading, setLoading] = useState(Boolean(orderId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(
    orderId ? "" : i18n.translate("noOrder"),
  );
  const [success, setSuccess] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [creditLabel, setCreditLabel] = useState("");
  const [customerLink, setCustomerLink] = useState("");
  const [previewHref, setPreviewHref] = useState("");
  const [printHref, setPrintHref] = useState("");
  const [hasInvoice, setHasInvoice] = useState(false);

  async function authHeaders(extra = {}) {
    /** @type {Record<string, string>} */
    const headers = { ...extra };
    try {
      if (shopify.auth?.idToken) {
        const token = await shopify.auth.idToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch (err) {
      console.error("idToken failed", err);
    }
    return headers;
  }

  async function sessionToken() {
    try {
      if (shopify.auth?.idToken) {
        return (await shopify.auth.idToken()) || "";
      }
    } catch (err) {
      console.error("idToken failed", err);
    }
    return "";
  }

  async function createCustomerLink(headers) {
    const res = await fetchWithTimeout(invoiceCustomerLinkPath(orderId), {
      method: "POST",
      headers:
        headers ||
        (await authHeaders({ "Content-Type": "application/json" })),
      body: JSON.stringify({ orderId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.url) {
      throw new Error(
        actionSafeErrorMessage(
          res.status,
          json.error || i18n.translate("linkFailed"),
        ),
      );
    }
    return String(json.url);
  }

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      setHasInvoice(false);
      setError(i18n.translate("noOrder"));
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      setSuccess("");
      setCustomerLink("");
      setPreviewHref("");
      setPrintHref("");
      setCreditLabel("");

      try {
        const headers = await authHeaders();
        if (!headers.Authorization) {
          if (!cancelled) {
            setError(actionSafeErrorMessage(401));
            setHasInvoice(false);
          }
          return;
        }

        const docRes = await fetchWithTimeout(documentsSummaryPath(orderId), {
          headers,
        });
        const json = await docRes.json().catch(() => ({}));
        if (cancelled) return;

        if (!docRes.ok) {
          setError(
            actionSafeErrorMessage(
              docRes.status,
              json.error || `Failed to load documents (${docRes.status})`,
            ),
          );
          setHasInvoice(false);
          return;
        }

        const parsed = parseDocumentsSummary(json);
        if (!parsed.hasInvoice) {
          setHasInvoice(false);
          setError("");
          return;
        }

        setHasInvoice(true);
        setInvoiceNumber(parsed.invoiceNumber);
        setInvoiceStatus(parsed.invoiceStatus);
        setOrderNumber(parsed.orderNumber);
        setCreditLabel(creditNotesLabel(parsed.creditNotesCount));

        const token = await sessionToken();
        if (!cancelled && token) {
          setPreviewHref(invoicePreviewPath(orderId, token));
          // Old Action had no multi-doc picker — default print type is invoice (Phase C default).
          setPrintHref(
            buildOrderActionPrintHref({
              orderId,
              token,
              types: ["invoice"],
            }) || "",
          );
        }

        try {
          const url = await createCustomerLink({
            ...headers,
            "Content-Type": "application/json",
          });
          if (!cancelled) setCustomerLink(url);
        } catch (linkErr) {
          console.error("prefetch customer link failed", linkErr);
        }

        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.name === "AbortError"
              ? i18n.translate("timeout")
              : i18n.translate("loadFailed"),
          );
          setHasInvoice(false);
        }
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function onEmail() {
    if (!orderId || sending || loading || !hasInvoice) return;
    setSending(true);
    setError("");
    setSuccess("");
    try {
      const headers = await authHeaders({
        "Content-Type": "application/json",
      });
      if (!headers.Authorization) {
        setError(actionSafeErrorMessage(401));
        return;
      }
      const res = await fetchWithTimeout(invoiceEmailPath(orderId), {
        method: "POST",
        headers,
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          actionSafeErrorMessage(
            res.status,
            json.error || i18n.translate("emailFailed"),
          ),
        );
        return;
      }
      setSuccess(
        i18n.translate("emailSuccess", {
          email: json.to || i18n.translate("customer"),
        }),
      );
    } catch (err) {
      setError(
        err?.name === "AbortError"
          ? i18n.translate("emailTimeout")
          : i18n.translate("emailFailed"),
      );
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  const metaParts = [
    orderNumber ? `Order ${orderNumber}` : "",
    creditLabel,
  ].filter(Boolean);

  return (
    <s-admin-action heading={i18n.translate("heading")}>
      <s-button
        slot="primary-action"
        onClick={onEmail}
        disabled={sending || loading || !hasInvoice}
      >
        {sending ? i18n.translate("loading") : i18n.translate("email")}
      </s-button>
      <s-button slot="secondary-actions" onClick={close}>
        {i18n.translate("close")}
      </s-button>

      <s-stack direction="block" gap="base">
        {loading ? <s-text>{i18n.translate("loading")}</s-text> : null}
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        {success ? <s-banner tone="success">{success}</s-banner> : null}

        {!loading && !error && !hasInvoice ? (
          <s-banner tone="warning">{i18n.translate("empty")}</s-banner>
        ) : null}

        {hasInvoice ? (
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text type="strong">{invoiceNumber}</s-text>
              {invoiceStatus ? <s-badge>{invoiceStatus}</s-badge> : null}
            </s-stack>

            {metaParts.length ? (
              <s-text>{metaParts.join(" · ")}</s-text>
            ) : null}

            <s-stack direction="inline" gap="base">
              {previewHref ? (
                <s-link href={previewHref} target="_blank">
                  {i18n.translate("preview")}
                </s-link>
              ) : null}
              {printHref ? (
                <s-link href={printHref} target="_blank">
                  {i18n.translate("printInvoice")}
                </s-link>
              ) : null}
              <s-link href={OPEN_INVOICES_HREF}>
                {i18n.translate("openInvoices")}
              </s-link>
            </s-stack>

            {customerLink ? (
              <s-stack direction="block" gap="small">
                <s-text-field
                  label={i18n.translate("customerLinkLabel")}
                  value={customerLink}
                  readonly
                ></s-text-field>
                <s-link href={customerLink} target="_blank">
                  {i18n.translate("openCustomerLink")}
                </s-link>
              </s-stack>
            ) : null}
          </s-stack>
        ) : null}

        <s-text>{i18n.translate("printHint")}</s-text>
      </s-stack>
    </s-admin-action>
  );
}
