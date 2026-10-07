import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
  blockSafeErrorMessage,
  creditNotesLabel,
  documentsSummaryPath,
  invoiceCustomerLinkPath,
  invoiceEmailPath,
  invoicePreviewPath,
  numericOrderId,
  parseDocumentsSummary,
} from "./block-extension-logic.js";

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
 * Order details → Documents block
 * Thin UI over Group 15 Phase B APIs (no render/email/link logic in the extension).
 */
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { data, i18n } = shopify;
  const orderId = numericOrderId(data?.selected?.[0]?.id);

  const [loading, setLoading] = useState(Boolean(orderId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(
    orderId ? "" : i18n.translate("noOrder"),
  );
  const [success, setSuccess] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("");
  const [creditLabel, setCreditLabel] = useState("");
  const [customerLink, setCustomerLink] = useState("");
  const [previewHref, setPreviewHref] = useState("");
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
        blockSafeErrorMessage(
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
      setCreditLabel("");

      try {
        const headers = await authHeaders();
        if (!headers.Authorization) {
          if (!cancelled) {
            setError(blockSafeErrorMessage(401));
            setHasInvoice(false);
          }
          return;
        }

        const docRes = await fetchWithTimeout(
          documentsSummaryPath(orderId),
          { headers },
        );
        const json = await docRes.json().catch(() => ({}));
        if (cancelled) return;

        if (!docRes.ok) {
          setError(
            blockSafeErrorMessage(
              docRes.status,
              json.error || `Failed to load (${docRes.status})`,
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
        setCreditLabel(creditNotesLabel(parsed.creditNotesCount));

        const token = await sessionToken();
        if (!cancelled && token) {
          setPreviewHref(invoicePreviewPath(orderId, token));
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
    if (!orderId || sending) return;
    setSending(true);
    setError("");
    setSuccess("");
    try {
      const headers = await authHeaders({
        "Content-Type": "application/json",
      });
      if (!headers.Authorization) {
        setError(blockSafeErrorMessage(401));
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
          blockSafeErrorMessage(
            res.status,
            json.error || `Email failed (${res.status})`,
          ),
        );
        return;
      }
      setSuccess(
        i18n.translate("emailSuccess", {
          to: json.to || i18n.translate("customer"),
        }),
      );
    } catch (err) {
      setError(
        err?.name === "AbortError"
          ? i18n.translate("timeout")
          : i18n.translate("emailFailed"),
      );
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <s-admin-block heading={i18n.translate("heading")}>
      <s-stack direction="block" gap="base">
        {loading ? (
          <s-stack direction="inline" gap="base">
            <s-spinner></s-spinner>
            <s-text>{i18n.translate("loading")}</s-text>
          </s-stack>
        ) : null}

        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        {success ? <s-banner tone="success">{success}</s-banner> : null}

        {!loading && !error && !hasInvoice ? (
          <s-text>{i18n.translate("empty")}</s-text>
        ) : null}

        {hasInvoice ? (
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text type="strong">{invoiceNumber}</s-text>
              {invoiceStatus ? <s-badge>{invoiceStatus}</s-badge> : null}
            </s-stack>

            {creditLabel ? <s-text>{creditLabel}</s-text> : null}

            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={onEmail}
                disabled={sending || loading}
              >
                {sending
                  ? i18n.translate("sending")
                  : i18n.translate("email")}
              </s-button>
              {previewHref ? (
                <s-link href={previewHref} target="_blank">
                  {i18n.translate("preview")}
                </s-link>
              ) : null}
              <s-link href="app://app/invoices">
                {i18n.translate("openApp")}
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

            <s-text>{i18n.translate("printTip")}</s-text>
          </s-stack>
        ) : null}
      </s-stack>
    </s-admin-block>
  );
}
