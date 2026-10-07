import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
  buildPrintSrc,
  collectPrintTypes,
  defaultPrintSelection,
  numericOrderId,
  printActionErrorMessage,
} from "./print-action-logic.js";

/**
 * Order details → Print menu
 * Builds `/app/print?orderId=&types=&token=` for Phase B HTML (no local render).
 */
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, data } = shopify;
  const orderId = numericOrderId(data?.selected?.[0]?.id);

  const defaults = defaultPrintSelection();
  const [printInvoice, setPrintInvoice] = useState(defaults.invoice);
  const [printPackingSlip, setPrintPackingSlip] = useState(
    defaults.packingSlip,
  );
  const [printCreditNote, setPrintCreditNote] = useState(defaults.creditNote);
  const [printRefund, setPrintRefund] = useState(defaults.refundDocument);

  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [error, setError] = useState(
    orderId ? "" : printActionErrorMessage("no_order"),
  );

  useEffect(() => {
    if (!orderId) {
      setSrc(null);
      setLoading(false);
      setError(printActionErrorMessage("no_order"));
      return;
    }

    const types = collectPrintTypes({
      invoice: printInvoice,
      packingSlip: printPackingSlip,
      creditNote: printCreditNote,
      refundDocument: printRefund,
    });

    if (!types.length) {
      setSrc(null);
      setLoading(false);
      setError(printActionErrorMessage("no_types"));
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      // Clear src while resolving token so Print cannot fire a stale/unauthed URL.
      setSrc(null);

      try {
        let token = "";
        if (shopify.auth?.idToken) {
          token = (await shopify.auth.idToken()) || "";
        }
        if (cancelled) return;

        if (!token) {
          setSrc(null);
          setError(printActionErrorMessage("no_token"));
          return;
        }

        const nextSrc = buildPrintSrc({ orderId, types, token });
        if (!nextSrc) {
          setSrc(null);
          setError(printActionErrorMessage("build_failed"));
          return;
        }

        setSrc(nextSrc);
        setError("");
      } catch (err) {
        console.error("print idToken failed", err);
        if (!cancelled) {
          setSrc(null);
          setError(printActionErrorMessage("no_token"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    orderId,
    printInvoice,
    printPackingSlip,
    printCreditNote,
    printRefund,
  ]);

  return (
    <s-admin-print-action src={src}>
      <s-stack direction="block" gap="base">
        <s-text type="strong">{i18n.translate("documents")}</s-text>
        <s-text>
          {orderId
            ? i18n.translate("orderLabel", { orderId })
            : i18n.translate("noOrder")}
        </s-text>

        {loading ? (
          <s-banner tone="info" heading={i18n.translate("loadingTitle")}>
            {i18n.translate("loadingBody")}
          </s-banner>
        ) : null}

        {error ? (
          <s-banner tone="critical" heading={i18n.translate("errorTitle")}>
            {error}
          </s-banner>
        ) : null}

        <s-checkbox
          name="Invoice"
          checked={printInvoice}
          label={i18n.translate("invoice")}
          onChange={(event) => {
            setPrintInvoice(
              /** @type {HTMLInputElement} */ (event.target).checked,
            );
          }}
        ></s-checkbox>
        <s-checkbox
          name="Packing Slip"
          checked={printPackingSlip}
          label={i18n.translate("packingSlip")}
          onChange={(event) => {
            setPrintPackingSlip(
              /** @type {HTMLInputElement} */ (event.target).checked,
            );
          }}
        ></s-checkbox>
        <s-checkbox
          name="Credit Note"
          checked={printCreditNote}
          label={i18n.translate("creditNote")}
          onChange={(event) => {
            setPrintCreditNote(
              /** @type {HTMLInputElement} */ (event.target).checked,
            );
          }}
        ></s-checkbox>
        <s-checkbox
          name="Refund Document"
          checked={printRefund}
          label={i18n.translate("refundDocument")}
          onChange={(event) => {
            setPrintRefund(
              /** @type {HTMLInputElement} */ (event.target).checked,
            );
          }}
        ></s-checkbox>

        <s-text>{i18n.translate("hint")}</s-text>
      </s-stack>
    </s-admin-print-action>
  );
}
