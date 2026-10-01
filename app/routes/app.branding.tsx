import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  InvoiceLogoField,
  invoiceLogoFromStoredUrl,
  type InvoiceLogoValue,
} from "../components/invoice-logo-field";
import {
  INVALID_HEX_MESSAGE,
  type StoreBrandingFormData,
} from "../models/branding";
import {
  getBrandingInputForShop,
  saveBrandingForShop,
} from "../models/branding.server";
import { authenticate } from "../shopify.server";
import { buildBrandingPreviewSrcDoc } from "../utils/branding-preview";
import { isNetworkFetchError } from "../utils/network-error";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const SAVE_BAR_ID = "branding-save-bar";
const GRID_3_COLS = "@container (inline-size > 768px) 1fr 1fr 1fr, 1fr";
const PAGE_LAYOUT_COLS = "@container (inline-size > 900px) 1.15fr 0.85fr, 1fr";
const CONNECTION_ERROR_MESSAGE =
  "Check your connection and try again.";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const branding = await getBrandingInputForShop(session.shop);
  return { branding };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const logoData = String(formData.get("logoData") ?? "").trim();
  const logoUrl = String(formData.get("logoUrl") ?? "").trim();

  const result = await saveBrandingForShop(
    session.shop,
    {
      primaryColor: String(formData.get("primaryColor") ?? ""),
      secondaryColor: String(formData.get("secondaryColor") ?? ""),
      accentColor: String(formData.get("accentColor") ?? ""),
      logoUrl: logoData || logoUrl,
      footerText: String(formData.get("footerText") ?? ""),
    },
    { logoUploadAttempted: Boolean(logoData) },
  );

  if (result.error) {
    return { error: result.error, branding: result.branding };
  }

  return { ok: true as const, branding: result.branding };
};

export default function BrandingPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saving =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const awaitingResult = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);

  const serverBranding =
    fetcher.data && "branding" in fetcher.data
      ? fetcher.data.branding
      : loaderData.branding;
  const serverKey = JSON.stringify(serverBranding);

  const [baseline, setBaseline] = useState<StoreBrandingFormData>(serverBranding);
  const [form, setForm] = useState<StoreBrandingFormData>(serverBranding);
  const [logo, setLogo] = useState<InvoiceLogoValue>(() =>
    invoiceLogoFromStoredUrl(serverBranding.logoUrl),
  );
  const [baselineLogo, setBaselineLogo] = useState<InvoiceLogoValue>(() =>
    invoiceLogoFromStoredUrl(serverBranding.logoUrl),
  );
  const [logoResetToken, setLogoResetToken] = useState(0);
  const [hexError, setHexError] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setForm(serverBranding);
    setBaseline(serverBranding);
    const nextLogo = invoiceLogoFromStoredUrl(serverBranding.logoUrl);
    setLogo(nextLogo);
    setBaselineLogo(nextLogo);
    setLogoResetToken((token) => token + 1);
    setHexError("");
    // Sync only when server payload changes (load / save response).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  useEffect(() => {
    if (!awaitingResult.current || fetcher.state !== "idle") return;
    awaitingResult.current = false;

    if (!fetcher.data || fetcher.data === dataAtSubmit.current) {
      setConnectionError(true);
      setSaveError("");
      shopify.toast.show("Couldn't save", { isError: true });
      return;
    }

    setConnectionError(false);

    if ("ok" in fetcher.data && fetcher.data.ok) {
      setSaveError("");
      shopify.toast.show("Invoice branding saved");
      shopify.saveBar.hide(SAVE_BAR_ID);
      return;
    }

    if ("error" in fetcher.data && fetcher.data.error) {
      setSaveError(fetcher.data.error);
    }
  }, [fetcher.data, fetcher.state, shopify]);

  useEffect(() => {
    shopify.loading(saving);
    return () => {
      shopify.loading(false);
    };
  }, [saving, shopify]);

  const dirty = useMemo(
    () =>
      JSON.stringify(form) !== JSON.stringify(baseline) ||
      logo.src !== baselineLogo.src ||
      logo.source !== baselineLogo.source,
    [form, baseline, logo, baselineLogo],
  );

  useEffect(() => {
    if (dirty) {
      shopify.saveBar.show(SAVE_BAR_ID);
    } else {
      shopify.saveBar.hide(SAVE_BAR_ID);
    }
    return () => {
      shopify.saveBar.hide(SAVE_BAR_ID);
    };
  }, [dirty, shopify]);

  const patchColor = (
    key: "primaryColor" | "secondaryColor" | "accentColor",
    value: string,
  ) => {
    setHexError("");
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const discardChanges = () => {
    if (saving) return;
    setForm(baseline);
    setLogo(baselineLogo);
    setLogoResetToken((token) => token + 1);
    setHexError("");
    setConnectionError(false);
    setSaveError("");
    shopify.saveBar.hide(SAVE_BAR_ID);
  };

  const saveForm = () => {
    if (saving) return;
    const colors = [form.primaryColor, form.secondaryColor, form.accentColor];
    if (colors.some((value) => value && !HEX_COLOR.test(value))) {
      setHexError(INVALID_HEX_MESSAGE);
      return;
    }
    setHexError("");
    setConnectionError(false);
    setSaveError("");
    const body = new FormData();
    body.set("logoData", logo.src.startsWith("data:") ? logo.src : "");
    body.set(
      "logoUrl",
      logo.src && !logo.src.startsWith("data:") ? logo.src : "",
    );
    body.set("primaryColor", form.primaryColor);
    body.set("secondaryColor", form.secondaryColor);
    body.set("accentColor", form.accentColor);
    body.set("footerText", form.footerText);
    dataAtSubmit.current = fetcher.data;
    awaitingResult.current = true;
    fetcher.submit(body, { method: "post" });
  };

  return (
    <s-page heading="Invoice branding" inlineSize="large">
      <ui-save-bar id={SAVE_BAR_ID}>
        <button
          variant="primary"
          onClick={saveForm}
          {...(saving ? { disabled: true, loading: true } : {})}
        >
          Save
        </button>
        <button
          onClick={discardChanges}
          {...(saving ? { disabled: true } : {})}
        >
          Discard
        </button>
      </ui-save-bar>

      {connectionError ? (
        <s-banner
          tone="critical"
          heading="Couldn't save"
          dismissible
          onDismiss={() => setConnectionError(false)}
        >
          {CONNECTION_ERROR_MESSAGE}
        </s-banner>
      ) : null}
      {saveError ? (
        <s-banner tone="critical" heading="Couldn't save">
          {saveError}
        </s-banner>
      ) : null}
      {hexError ? (
        <s-banner tone="critical" heading="Check brand colors">
          {hexError}
        </s-banner>
      ) : null}

      <s-query-container>
        <s-grid
          gridTemplateColumns={PAGE_LAYOUT_COLS}
          gap="large"
          alignItems="start"
        >
          <s-stack gap="large">
            <InvoiceLogoField
              value={logo}
              onChange={setLogo}
              resetToken={logoResetToken}
            />

            <s-section
              heading="Brand colors"
              subheading="Primary drives headers; accent highlights totals and key amounts."
            >
              <s-query-container>
                <s-grid gridTemplateColumns={GRID_3_COLS} gap="base">
                  <ColorField
                    label="Primary"
                    fallback="#008060"
                    value={form.primaryColor}
                    details="Headers and borders"
                    onChange={(value) => patchColor("primaryColor", value)}
                  />
                  <ColorField
                    label="Secondary"
                    fallback="#6d7175"
                    value={form.secondaryColor}
                    details="Labels and supporting text"
                    onChange={(value) => patchColor("secondaryColor", value)}
                  />
                  <ColorField
                    label="Accent"
                    fallback="#004c3f"
                    value={form.accentColor}
                    details="Totals and highlights"
                    onChange={(value) => patchColor("accentColor", value)}
                  />
                </s-grid>
              </s-query-container>
            </s-section>

            <s-section
              heading="Footer message"
              subheading="A short line shown at the bottom of every invoice."
            >
              <s-text-area
                label="Custom footer message"
                value={form.footerText}
                maxLength={500}
                rows={2}
                placeholder="Thank you for your business"
                details={`${form.footerText.length} / 500 characters`}
                onInput={(event: Event) =>
                  setForm((prev) => ({
                    ...prev,
                    footerText: fieldValue(event),
                  }))
                }
                onChange={(event: Event) =>
                  setForm((prev) => ({
                    ...prev,
                    footerText: fieldValue(event),
                  }))
                }
              />
            </s-section>
          </s-stack>

          <s-section heading="Live preview" subheading="Updates as you edit">
            <InvoiceBrandingPreview
              logoSrc={logo.src}
              primaryColor={form.primaryColor}
              accentColor={form.accentColor}
              footerText={form.footerText}
            />
          </s-section>
        </s-grid>
      </s-query-container>
    </s-page>
  );
}

function InvoiceBrandingPreview({
  logoSrc,
  primaryColor,
  accentColor,
  footerText,
}: {
  logoSrc: string;
  primaryColor: string;
  accentColor: string;
  footerText: string;
}) {
  const primary = HEX_COLOR.test(primaryColor) ? primaryColor : "#008060";
  const accent = HEX_COLOR.test(accentColor) ? accentColor : "#004c3f";
  const [embedLogo, setEmbedLogo] = useState("");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!logoSrc) {
      setEmbedLogo("");
      return;
    }

    if (logoSrc.startsWith("data:") || /^https?:\/\//i.test(logoSrc)) {
      setEmbedLogo(logoSrc);
      return;
    }

    if (!logoSrc.startsWith("blob:")) {
      setEmbedLogo("");
      return;
    }

    fetch(logoSrc)
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("read failed"));
            reader.readAsDataURL(blob);
          }),
      )
      .then((dataUrl) => {
        if (!cancelled) setEmbedLogo(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setEmbedLogo("");
      });

    return () => {
      cancelled = true;
    };
  }, [logoSrc]);

  const srcDoc = useMemo(
    () =>
      buildBrandingPreviewSrcDoc({
        primaryColor: primary,
        accentColor: accent,
        logoSrc: embedLogo,
        footerText,
      }),
    [primary, accent, embedLogo, footerText],
  );

  const fitIframe = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) return;
    iframe.style.height = `${Math.max(doc.body.scrollHeight, 240)}px`;
  };

  useEffect(() => {
    fitIframe();
  }, [srcDoc]);

  return (
    <s-stack gap="small">
      <s-box
        padding="none"
        background="subdued"
        border="base"
        borderRadius="base"
        overflow="hidden"
      >
        <iframe
          ref={iframeRef}
          title="Invoice branding live preview"
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          onLoad={fitIframe}
          style={{
            display: "block",
            width: "100%",
            border: 0,
            background: "transparent",
            minHeight: 240,
          }}
        />
      </s-box>
      <s-text color="subdued">
        Applies to Modern, Professional, Classic Stripe, and custom templates.
      </s-text>
    </s-stack>
  );
}

function ColorField({
  label,
  fallback,
  value,
  details,
  onChange,
}: {
  label: string;
  fallback: string;
  value: string;
  details: string;
  onChange: (value: string) => void;
}) {
  const pickerValue = HEX_COLOR.test(value) ? value : fallback;
  const applyPicker = (event: Event) => {
    const next = fieldValue(event);
    if (!HEX_COLOR.test(next)) return;
    if (
      !HEX_COLOR.test(value) &&
      next.toLowerCase() === fallback.toLowerCase()
    ) {
      return;
    }
    onChange(next);
  };

  return (
    <s-color-field
      label={label}
      value={pickerValue}
      details={details}
      onInput={applyPicker}
      onChange={applyPicker}
    />
  );
}

type BrandingField =
  | HTMLElementTagNameMap["s-text-field"]
  | HTMLElementTagNameMap["s-text-area"]
  | HTMLElementTagNameMap["s-color-field"];

function isBrandingField(target: EventTarget | null): target is BrandingField {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "S-TEXT-FIELD" ||
      target.tagName === "S-TEXT-AREA" ||
      target.tagName === "S-COLOR-FIELD")
  );
}

function fieldValue(event: Event) {
  const target = event.currentTarget ?? event.target;
  if (!isBrandingField(target)) return "";
  return target.value ?? "";
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  const error = useRouteError();

  if (isNetworkFetchError(error)) {
    return (
      <s-page heading="Invoice branding" inlineSize="large">
        <s-banner tone="critical" heading="Couldn't save">
          Check your connection and try again.
        </s-banner>
        <s-button href="/app/branding" variant="primary">
          Try again
        </s-button>
      </s-page>
    );
  }

  return boundary.error(error);
}
