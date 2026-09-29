import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  INVALID_HEX_MESSAGE,
  LOGO_INVALID_MESSAGE,
  LOGO_TOO_LARGE_MESSAGE,
  getBrandingInputForShop,
  saveBrandingForShop,
  type StoreBrandingFormData,
} from "../models/branding.server";
import { authenticate } from "../shopify.server";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const MAX_LOGO_BYTES = 500_000;
const PREVIEW_PATH = "/app/templates/preview/modern";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const branding = await getBrandingInputForShop(session.shop);
  const saved = new URL(request.url).searchParams.get("saved") === "1";
  return { branding, saved };
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

  const url = new URL(request.url);
  url.searchParams.set("saved", "1");
  return redirect(`${url.pathname}?${url.searchParams.toString()}`);
};

export default function BrandingPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const initial =
    actionData && "branding" in actionData ? actionData.branding : loaderData.branding;

  const [form, setForm] = useState<StoreBrandingFormData>(initial);
  const [logoData, setLogoData] = useState(
    initial.logoUrl.startsWith("data:") ? initial.logoUrl : "",
  );
  const [logoError, setLogoError] = useState("");
  const [hexError, setHexError] = useState("");
  const logoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(initial);
    setLogoData(initial.logoUrl.startsWith("data:") ? initial.logoUrl : "");
  }, [initial]);

  const previewLogo = logoData || form.logoUrl;
  const footerPreview = form.footerText.trim() || "Thank you for your business";

  const patchColor = (
    key: "primaryColor" | "secondaryColor" | "accentColor",
    value: string,
  ) => {
    setHexError("");
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetLogoFile = () => {
    if (logoFileRef.current) logoFileRef.current.value = "";
  };

  const onLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      resetLogoFile();
      setLogoError(LOGO_TOO_LARGE_MESSAGE);
      return;
    }
    setLogoError("");
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      setLogoData(result);
      setForm((prev) => ({ ...prev, logoUrl: "" }));
    };
    reader.onerror = () => {
      resetLogoFile();
      setLogoError(LOGO_INVALID_MESSAGE);
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => {
    resetLogoFile();
    setLogoData("");
    setLogoError("");
    setForm((prev) => ({ ...prev, logoUrl: "" }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const colors = [form.primaryColor, form.secondaryColor, form.accentColor];
    if (colors.some((value) => value && !HEX_COLOR.test(value))) {
      event.preventDefault();
      setHexError(INVALID_HEX_MESSAGE);
    }
  };

  return (
    <s-page heading="Invoice branding">
      <s-section>
        <s-stack gap="base">
          <s-text>Store identity</s-text>
          <s-paragraph>
            Logo, colors, and footer copy flow into every template preview, PDF,
            and customer download.
          </s-paragraph>
          <s-link href={PREVIEW_PATH} target="_blank">
            Open full preview
          </s-link>
        </s-stack>
      </s-section>

      {loaderData.saved && !(actionData && "error" in actionData) ? (
        <s-banner tone="success" heading="Branding saved">
          Branding saved. Open a template preview to see your changes.
        </s-banner>
      ) : null}
      {actionData && "error" in actionData ? (
        <s-banner tone="critical" heading="Logo not saved">
          {actionData.error}
        </s-banner>
      ) : null}
      {logoError ? (
        <s-banner tone="critical" heading="Logo not saved">
          {logoError}
        </s-banner>
      ) : null}
      {hexError ? (
        <s-banner tone="critical" heading="Check brand colors">
          {hexError}
        </s-banner>
      ) : null}

      <form method="post" onSubmit={onSubmit}>
        <input type="hidden" name="logoData" value={logoData} />
        <input
          type="hidden"
          name="logoUrl"
          value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl}
        />
        <input type="hidden" name="primaryColor" value={form.primaryColor} />
        <input type="hidden" name="secondaryColor" value={form.secondaryColor} />
        <input type="hidden" name="accentColor" value={form.accentColor} />
        <input type="hidden" name="footerText" value={form.footerText} />
        <s-stack gap="base">
          <s-section heading="Logo">
            <s-paragraph>Displayed on invoice headers across your templates.</s-paragraph>
            <s-stack gap="base">
              {previewLogo ? (
                <img
                  src={previewLogo}
                  alt="Store logo"
                  style={{ maxWidth: "160px", maxHeight: "80px", objectFit: "contain" }}
                />
              ) : (
                <s-text>No logo yet</s-text>
              )}
              <s-text-field
                label="Logo URL"
                value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl}
                placeholder="https://cdn.shopify.com/…"
                details="Public image URL from your store or CDN"
                onInput={(event: Event) => {
                  setLogoData("");
                  setLogoError("");
                  setForm((prev) => ({
                    ...prev,
                    logoUrl: fieldValue(event),
                  }));
                }}
              />
              <s-text>Upload image</s-text>
              <input
                ref={logoFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => onLogoFile(event.currentTarget.files?.[0])}
              />
              <s-text>PNG, JPG, or WebP · max 500 KB</s-text>
              {previewLogo ? (
                <s-button type="button" tone="critical" onClick={clearLogo}>
                  Remove logo
                </s-button>
              ) : null}
            </s-stack>
          </s-section>

          <s-section heading="Brand colors">
            <s-paragraph>
              Primary drives headers; accent highlights totals and key amounts.
            </s-paragraph>
            <ColorField
              label="Primary"
              fallback="#008060"
              value={form.primaryColor}
              description="Headers, borders, tax strip"
              onChange={(value) => patchColor("primaryColor", value)}
            />
            <ColorField
              label="Secondary"
              fallback="#6d7175"
              value={form.secondaryColor}
              description="Labels and supporting text"
              onChange={(value) => patchColor("secondaryColor", value)}
            />
            <ColorField
              label="Accent"
              fallback="#004c3f"
              value={form.accentColor}
              description="Totals and highlights"
              onChange={(value) => patchColor("accentColor", value)}
            />
          </s-section>

          <s-section heading="Footer message">
            <s-paragraph>A short line shown at the bottom of every invoice.</s-paragraph>
            <s-text-area
              label="Custom footer message"
              value={form.footerText}
              maxLength={500}
              rows={2}
              placeholder="Thank you for your business"
              details={`${form.footerText.length} / 500 characters`}
              onInput={(event: Event) =>
                setForm((prev) => ({ ...prev, footerText: fieldValue(event) }))
              }
            />
          </s-section>

          <s-section heading="Live preview">
            <s-text>Updates as you edit</s-text>
            <InvoiceMock
              primary={safeHex(form.primaryColor, "#008060")}
              secondary={safeHex(form.secondaryColor, "#6d7175")}
              accent={safeHex(form.accentColor, "#004c3f")}
              logoUrl={previewLogo}
              footer={footerPreview}
            />
            <s-paragraph>
              Applies to Modern, Professional, Classic Stripe, and custom templates.
            </s-paragraph>
          </s-section>

          <s-button
            type="submit"
            variant="primary"
            {...(saving ? { loading: true } : {})}
            disabled={saving}
          >
            Save
          </s-button>
        </s-stack>
      </form>
    </s-page>
  );
}

function ColorField({
  label,
  fallback,
  value,
  description,
  onChange,
}: {
  label: string;
  fallback: string;
  value: string;
  description: string;
  onChange: (value: string) => void;
}) {
  const pickerValue = HEX_COLOR.test(value) ? value : fallback;
  const applyPicker = (event: Event) => {
    const next = fieldValue(event);
    if (!HEX_COLOR.test(next)) return;
    if (!HEX_COLOR.test(value) && next.toLowerCase() === fallback.toLowerCase()) return;
    onChange(next);
  };
  return (
    <s-stack gap="small">
      <s-color-field
        label={label}
        value={pickerValue}
        onInput={applyPicker}
        onChange={applyPicker}
      />
      <s-text-field
        label={`${label} hex`}
        labelAccessibilityVisibility="exclusive"
        value={value}
        maxLength={7}
        onInput={(event: Event) => onChange(fieldValue(event))}
      />
      <s-text>{description}</s-text>
    </s-stack>
  );
}

function InvoiceMock({
  primary,
  secondary,
  accent,
  logoUrl,
  footer,
}: {
  primary: string;
  secondary: string;
  accent: string;
  logoUrl: string;
  footer: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: "12px",
        overflow: "hidden",
        background: "#fff",
        maxWidth: "360px",
      }}
    >
      <div
        style={{
          height: "8px",
          background: `linear-gradient(90deg, ${primary}, ${accent}, ${primary})`,
        }}
      />
      <div style={{ padding: "16px" }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            style={{ maxWidth: "120px", maxHeight: "48px", objectFit: "contain" }}
          />
        ) : null}
        <div style={{ color: primary, fontWeight: 700, marginTop: "8px" }}>TAX INVOICE</div>
        <div style={{ color: secondary, fontSize: "12px" }}>INV-00042 · USD</div>
        <div
          style={{
            marginTop: "10px",
            background: primary,
            color: "#fff",
            fontSize: "12px",
            padding: "4px 8px",
            display: "inline-block",
          }}
        >
          Tax ID · 100000000000003
        </div>
        <div
          style={{
            marginTop: "12px",
            background: primary,
            color: "#fff",
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 8px",
            fontSize: "12px",
          }}
        >
          <span>Item</span>
          <span>Total</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", fontSize: "13px" }}>
          <span>Sample product</span>
          <span>315.00</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", fontSize: "13px" }}>
          <span>Shipping</span>
          <span>26.25</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px",
            fontWeight: 700,
            color: accent,
          }}
        >
          <span>Amount due</span>
          <span>341.25 USD</span>
        </div>
        <div style={{ color: secondary, fontSize: "12px", padding: "8px" }}>{footer}</div>
      </div>
    </div>
  );
}

function safeHex(value: string, fallback: string) {
  return HEX_COLOR.test(value) ? value : fallback;
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
  if (!isBrandingField(event.currentTarget)) return "";
  return event.currentTarget.value;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
