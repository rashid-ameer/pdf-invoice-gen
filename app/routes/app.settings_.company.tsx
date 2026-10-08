import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  OnboardingError,
  loadCompanySetup,
  saveCompanySetup,
  type CompanySetupData,
} from "../models/onboarding.server";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  socialLinksFormFieldNames,
  type SocialPlatform,
} from "../models/social-links";
import { authenticate } from "../shopify.server";

/**
 * Side-by-side fields in the content panel.
 * Breakpoint is lower than the page sidebar (768) because the panel is
 * narrower than the full page once the nav column is present.
 */
const GRID_2_COLS = "@container (inline-size > 480px) 1fr 1fr, 1fr";
const GRID_3_COLS = "@container (inline-size > 480px) 1fr 1fr 1fr, 1fr";
/** Sidebar nav + section panel; stack on narrow containers. */
const SECTION_LAYOUT_COLS =
  "@container (inline-size > 768px) 220px 1fr, 1fr";

const STEPS = [
  {
    label: "Business Info",
    heading: "Business identity",
    subheading:
      "Legal seller name as registered with your tax authority — shown on every invoice.",
  },
  {
    label: "Tax",
    heading: "Tax & registration IDs",
    subheading:
      "Tax IDs used on invoices and for electronic invoicing network routing when compliance mode is enabled.",
  },
  {
    label: "Address",
    heading: "Registered address",
    subheading: "Registered business address shown on invoices.",
  },
  {
    label: "Contact",
    heading: "Business contact",
    subheading:
      "Appears on documents and used as default reply-to for customer email delivery.",
  },
  {
    label: "Invoice Defaults",
    heading: "Invoice defaults",
    subheading:
      "Store-level numbering and VAT defaults. Currency comes from your Shopify store; each invoice keeps its order currency.",
  },
  {
    label: "Social Links",
    heading: "Social links",
    subheading:
      "Optional website and social profiles shown at the bottom of invoices with icons.",
  },
] as const;

const SAVE_BAR_ID = "company-setup-save-bar";

const COUNTRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "AE", label: "United Arab Emirates" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "IN", label: "India" },
  { value: "PK", label: "Pakistan" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "IT", label: "Italy" },
  { value: "ES", label: "Spain" },
  { value: "NL", label: "Netherlands" },
  { value: "IE", label: "Ireland" },
  { value: "SG", label: "Singapore" },
  { value: "MY", label: "Malaysia" },
  { value: "PH", label: "Philippines" },
  { value: "NZ", label: "New Zealand" },
  { value: "ZA", label: "South Africa" },
  { value: "EG", label: "Egypt" },
  { value: "JO", label: "Jordan" },
  { value: "KW", label: "Kuwait" },
  { value: "QA", label: "Qatar" },
  { value: "BH", label: "Bahrain" },
  { value: "OM", label: "Oman" },
];

type SetupForm = {
  legalName: string;
  tradeName: string;
  vatStatus: string;
  trn: string;
  tin: string;
  tradeLicence: string;
  addressLine1: string;
  addressLine2: string;
  emirate: string;
  city: string;
  postalCode: string;
  country: string;
  businessEmail: string;
  businessPhone: string;
  vatRate: string;
  taxInclusive: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  showSocialLinks: boolean;
  social: Record<SocialPlatform, { label: string; url: string }>;
};

type FieldErrors = Partial<Record<string, string>>;

function collectStepErrors(index: number, data: SetupForm): FieldErrors {
  const next: FieldErrors = {};
  if (index === 0 && !data.legalName.trim()) {
    next.legalName = "Enter your legal company name.";
  }
  if (index === 1 && data.vatStatus === "registered" && !data.trn.trim()) {
    next.trn =
      "Enter your TRN. Required for VAT-registered businesses.";
  }
  if (index === 2) {
    if (!data.addressLine1.trim()) {
      next.addressLine1 = "Enter your street address.";
    }
    if (!data.city.trim()) next.city = "Enter your city.";
    if (!data.country.trim()) {
      next.country = "Select your country or region.";
    }
  }
  if (index === 3) {
    if (!data.businessEmail.trim()) {
      next.businessEmail = "Enter your business email.";
    }
    if (!data.businessPhone.trim()) {
      next.businessPhone = "Business phone is required.";
    }
  }
  if (index === 4) {
    const vat = data.vatRate.trim();
    if (!vat) {
      next.vatRate = "Enter a default VAT rate.";
    } else {
      const rate = Number(vat);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        next.vatRate = "VAT rate must be a number between 0 and 100.";
      }
    }
    if (!data.invoicePrefix.trim()) {
      next.invoicePrefix = "Enter an invoice prefix.";
    }
    if (!data.creditNotePrefix.trim()) {
      next.creditNotePrefix = "Enter a credit note prefix.";
    }
  }
  return next;
}

function emptySocial(): Record<SocialPlatform, { label: string; url: string }> {
  return Object.fromEntries(
    SOCIAL_PLATFORMS.map((platform) => [
      platform,
      { label: SOCIAL_PLATFORM_LABELS[platform], url: "" },
    ]),
  ) as Record<SocialPlatform, { label: string; url: string }>;
}

function toForm(data: CompanySetupData): SetupForm {
  const social = emptySocial();
  const links = data.socialLinks ?? { showOnInvoice: false };
  for (const platform of SOCIAL_PLATFORMS) {
    const entry = links[platform];
    social[platform] = {
      label: entry?.label?.trim() || SOCIAL_PLATFORM_LABELS[platform],
      url: entry?.url ?? "",
    };
  }

  const country = (data.legalEntity.country || "").toUpperCase();
  const known = COUNTRY_OPTIONS.some((option) => option.value === country);

  return {
    legalName: data.legalEntity.legalName,
    tradeName: data.legalEntity.tradeName,
    vatStatus: data.legalEntity.vatStatus || "registered",
    trn: data.legalEntity.trn,
    tin: data.legalEntity.tin,
    tradeLicence: data.legalEntity.tradeLicence,
    addressLine1: data.legalEntity.addressLine1,
    addressLine2: data.legalEntity.addressLine2,
    emirate: data.legalEntity.emirate,
    city: data.legalEntity.city,
    postalCode: data.legalEntity.postalCode,
    country: known ? country : country || "AE",
    businessEmail: data.legalEntity.businessEmail,
    businessPhone: data.legalEntity.businessPhone,
    vatRate: data.settings.vatRate,
    taxInclusive: data.settings.taxInclusive ? "true" : "false",
    invoicePrefix: data.settings.invoicePrefix,
    creditNotePrefix: data.settings.creditNotePrefix,
    showSocialLinks: links.showOnInvoice === true,
    social,
  };
}

function formToBody(form: SetupForm): Record<string, string> {
  const body: Record<string, string> = {
    legalName: form.legalName,
    tradeName: form.tradeName,
    vatStatus: form.vatStatus,
    trn: form.trn,
    tin: form.tin,
    tradeLicence: form.tradeLicence,
    addressLine1: form.addressLine1,
    addressLine2: form.addressLine2,
    emirate: form.emirate,
    city: form.city,
    postalCode: form.postalCode,
    country: form.country,
    businessEmail: form.businessEmail,
    businessPhone: form.businessPhone,
    vatRate: form.vatRate,
    taxInclusive: form.taxInclusive,
    invoicePrefix: form.invoicePrefix,
    creditNotePrefix: form.creditNotePrefix,
  };

  if (form.showSocialLinks) {
    body.showSocialLinks = "on";
  }

  for (const { platform, labelKey, urlKey } of socialLinksFormFieldNames()) {
    body[labelKey] = form.social[platform].label;
    body[urlKey] = form.social[platform].url;
  }

  return body;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const setup = await loadCompanySetup(session.shop);
  return { setup };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    body[key] = String(value);
  }

  try {
    await saveCompanySetup(session.shop, body);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof OnboardingError) {
      return { error: error.message };
    }
    throw error;
  }
};

export default function CompanySetupPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const saving = navigation.state === "submitting";

  const [baseline, setBaseline] = useState<SetupForm>(() =>
    toForm(loaderData.setup),
  );
  const [form, setForm] = useState<SetupForm>(() => toForm(loaderData.setup));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    const next = toForm(loaderData.setup);
    setForm(next);
    setBaseline(next);
  }, [loaderData.setup]);

  useEffect(() => {
    if (!actionData || !("ok" in actionData) || !actionData.ok) return;
    setBaseline(formRef.current);
    shopify.toast.show("Company details saved");
  }, [actionData, shopify]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
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

  const patch = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    }
  };

  const patchSocial = (
    platform: SocialPlatform,
    field: "label" | "url",
    value: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      social: {
        ...prev.social,
        [platform]: { ...prev.social[platform], [field]: value },
      },
    }));
  };

  const applyTinFromTrn = () => {
    setForm((prev) => {
      if (prev.tin.trim()) return prev;
      const digits = prev.trn.replace(/\D/g, "");
      if (digits.length < 10) return prev;
      return { ...prev, tin: digits.slice(0, 10) };
    });
  };

  const saveForm = () => {
    if (saving) return;
    for (let index = 0; index < STEPS.length; index += 1) {
      const stepErrors = collectStepErrors(index, form);
      if (Object.keys(stepErrors).length > 0) {
        setErrors(stepErrors);
        setStep(index);
        return;
      }
    }
    setErrors({});
    const body = formToBody(form);
    if (!body.tin.trim()) {
      const digits = body.trn.replace(/\D/g, "");
      if (digits.length >= 10) body.tin = digits.slice(0, 10);
    }
    submit(body, { method: "post" });
  };

  const discardChanges = () => {
    if (saving) return;
    setForm(baseline);
    setErrors({});
    shopify.saveBar.hide(SAVE_BAR_ID);
  };

  const selectSection = (index: number) => {
    if (saving || index === step) return;
    setErrors({});
    setStep(index);
  };

  const current = STEPS[step];

  const countryOptions =
    form.country &&
      !COUNTRY_OPTIONS.some((option) => option.value === form.country)
      ? [{ value: form.country, label: form.country }, ...COUNTRY_OPTIONS]
      : COUNTRY_OPTIONS;

  return (
    <s-page heading="Company setup" inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>
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
      <s-stack gap="large">
        {actionData && "error" in actionData ? (
          <s-banner tone="critical" heading="Could not save">
            {actionData.error}
          </s-banner>
        ) : null}

        <s-query-container>
          <s-grid
            gridTemplateColumns={SECTION_LAYOUT_COLS}
            gap="large"
            alignItems="start"
          >
            <div style={{ position: "sticky", top: "1rem", alignSelf: "start" }}>
              <s-section padding="none" accessibilityLabel="Company setup sections">
                <s-box border="base" borderRadius="base" padding="small">
                  <s-stack gap="small-400">
                    {STEPS.map((section, index) => {
                      const selected = index === step;
                      const incomplete =
                        Object.keys(collectStepErrors(index, form)).length > 0;
                      return (
                        <s-clickable
                          paddingBlock="small-400"
                          paddingInline="base"
                          borderRadius="base"
                          background={selected ? "strong" : "transparent"}
                          accessibilityLabel={`${section.label}${selected ? ", selected" : ""}${incomplete ? ", incomplete" : ""}`}
                          onClick={() => selectSection(index)}
                        >
                          <s-stack
                            direction="inline"
                            gap="small-200"
                            alignItems="center"
                            justifyContent="space-between"
                          >
                            <s-heading>{section.label}</s-heading>
                          </s-stack>
                        </s-clickable>
                      );
                    })}
                  </s-stack>
                </s-box>
              </s-section>
            </div>

            <s-section>
              <s-stack gap="base">
                <s-stack gap="none">
                  <s-heading>{current.heading}</s-heading>
                  {current.subheading ? (
                    <s-paragraph color="subdued">
                      {current.subheading}
                    </s-paragraph>
                  ) : null}
                </s-stack>

                <s-query-container>
                  <s-stack gap="base">
                    {step === 0 ? (
                      <s-stack gap="base">
                        <s-text-field
                          label="Legal company name"
                          value={form.legalName}
                          placeholder="Acme Trading LLC"
                          error={errors.legalName}
                          onInput={(event: Event) =>
                            patch("legalName", fieldValue(event))
                          }
                          onChange={(event: Event) =>
                            patch("legalName", fieldValue(event))
                          }
                        />
                        <s-text-field
                          label="Trade / brand name (optional)"
                          value={form.tradeName}
                          placeholder="Acme"
                          onInput={(event: Event) =>
                            patch("tradeName", fieldValue(event))
                          }
                          onChange={(event: Event) =>
                            patch("tradeName", fieldValue(event))
                          }
                        />
                        <s-select
                          label="VAT registration status"
                          value={form.vatStatus}
                          placeholder="Registered"
                          onChange={(event: Event) =>
                            patch("vatStatus", fieldValue(event))
                          }
                        >
                          <s-option value="registered">
                            VAT registered — issue tax invoices
                          </s-option>
                          <s-option value="not_registered">
                            Not VAT registered — commercial invoices
                          </s-option>
                        </s-select>
                      </s-stack>
                    ) : null}

                    {step === 1 ? (
                      <s-stack gap="base">
                        <s-grid gridTemplateColumns={GRID_2_COLS} gap="base">
                          <s-text-field
                            label="Tax registration number (VAT/GST)"
                            value={form.trn}
                            placeholder="100123456700003"
                            error={errors.trn}
                            onInput={(event: Event) =>
                              patch("trn", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("trn", fieldValue(event))
                            }
                            onBlur={applyTinFromTrn}
                          />
                          <s-text-field
                            label="Electronic invoicing ID (optional)"
                            value={form.tin}
                            placeholder="1001234567"
                            onInput={(event: Event) =>
                              patch("tin", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("tin", fieldValue(event))
                            }
                          />
                        </s-grid>
                        <s-text-field
                          label="Business registration ID (optional)"
                          value={form.tradeLicence}
                          placeholder="CN-1234567"
                          onInput={(event: Event) =>
                            patch("tradeLicence", fieldValue(event))
                          }
                          onChange={(event: Event) =>
                            patch("tradeLicence", fieldValue(event))
                          }
                        />
                      </s-stack>
                    ) : null}

                    {step === 2 ? (
                      <s-stack gap="base">
                        <s-text-field
                          label="Address"
                          value={form.addressLine1}
                          placeholder="123 Business Bay"
                          error={errors.addressLine1}
                          autocomplete="address-line1"
                          onInput={(event: Event) =>
                            patch("addressLine1", fieldValue(event))
                          }
                          onChange={(event: Event) =>
                            patch("addressLine1", fieldValue(event))
                          }
                        />
                        <s-text-field
                          label="Address line 2 (optional)"
                          value={form.addressLine2}
                          placeholder="Suite 401"
                          autocomplete="address-line2"
                          onInput={(event: Event) =>
                            patch("addressLine2", fieldValue(event))
                          }
                          onChange={(event: Event) =>
                            patch("addressLine2", fieldValue(event))
                          }
                        />
                        <s-text-field
                          label="City"
                          value={form.city}
                          placeholder="Dubai"
                          error={errors.city}
                          autocomplete="address-level2"
                          onInput={(event: Event) =>
                            patch("city", fieldValue(event))
                          }
                          onChange={(event: Event) =>
                            patch("city", fieldValue(event))
                          }
                        />
                        <s-grid gridTemplateColumns={GRID_3_COLS} gap="base">
                          <s-select
                            label="Country"
                            value={form.country}
                            placeholder="AE"
                            error={errors.country}
                            onChange={(event: Event) =>
                              patch("country", fieldValue(event))
                            }
                          >
                            {countryOptions.map((option) => (
                              <s-option key={option.value} value={option.value}>
                                {option.label}
                              </s-option>
                            ))}
                          </s-select>
                          <s-text-field
                            label="State / province / region (optional)"
                            value={form.emirate}
                            placeholder="Dubai"
                            autocomplete="address-level1"
                            onInput={(event: Event) =>
                              patch("emirate", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("emirate", fieldValue(event))
                            }
                          />
                          <s-text-field
                            label="Postal code (optional)"
                            value={form.postalCode}
                            placeholder="00000"
                            autocomplete="postal-code"
                            onInput={(event: Event) =>
                              patch("postalCode", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("postalCode", fieldValue(event))
                            }
                          />
                        </s-grid>
                      </s-stack>
                    ) : null}

                    {step === 3 ? (
                      <s-stack gap="base">
                        <s-grid gridTemplateColumns={GRID_2_COLS} gap="base">
                          <s-email-field
                            label="Business email"
                            value={form.businessEmail}
                            placeholder="billing@example.com"
                            error={errors.businessEmail}
                            onInput={(event: Event) =>
                              patch("businessEmail", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("businessEmail", fieldValue(event))
                            }
                          />
                          <s-text-field
                            label="Business phone"
                            value={form.businessPhone}
                            placeholder="+971 50 123 4567"
                            error={errors.businessPhone}
                            onInput={(event: Event) =>
                              patch("businessPhone", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("businessPhone", fieldValue(event))
                            }
                          />
                        </s-grid>
                      </s-stack>
                    ) : null}

                    {step === 4 ? (
                      <s-stack gap="base">
                        <s-grid gridTemplateColumns={GRID_2_COLS} gap="base">
                          <s-number-field
                            label="Default VAT rate (%)"
                            value={form.vatRate}
                            placeholder="5"
                            min={0}
                            max={100}
                            step={0.5}
                            error={errors.vatRate}
                            onInput={(event: Event) =>
                              patch("vatRate", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("vatRate", fieldValue(event))
                            }
                          />
                          <s-select
                            label="Tax handling"
                            value={form.taxInclusive}
                            placeholder="Exclusive"
                            onChange={(event: Event) =>
                              patch("taxInclusive", fieldValue(event))
                            }
                          >
                            <s-option value="false">
                              Tax exclusive (add on top)
                            </s-option>
                            <s-option value="true">
                              Tax inclusive (included in price)
                            </s-option>
                          </s-select>
                        </s-grid>
                        <s-grid gridTemplateColumns={GRID_2_COLS} gap="base">
                          <s-text-field
                            label="Invoice prefix"
                            value={form.invoicePrefix}
                            placeholder="INV-"
                            error={errors.invoicePrefix}
                            onInput={(event: Event) =>
                              patch("invoicePrefix", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("invoicePrefix", fieldValue(event))
                            }
                          />
                          <s-text-field
                            label="Credit note prefix"
                            value={form.creditNotePrefix}
                            placeholder="CN-"
                            error={errors.creditNotePrefix}
                            onInput={(event: Event) =>
                              patch("creditNotePrefix", fieldValue(event))
                            }
                            onChange={(event: Event) =>
                              patch("creditNotePrefix", fieldValue(event))
                            }
                          />
                        </s-grid>
                      </s-stack>
                    ) : null}

                    {step === 5 ? (
                      <s-stack gap="base">
                        <s-checkbox
                          label="Show social links on invoice footer"
                          checked={form.showSocialLinks}
                          onChange={(event: Event) => {
                            const target = event.currentTarget as HTMLInputElement & {
                              checked?: boolean;
                            };
                            patch("showSocialLinks", Boolean(target.checked));
                          }}
                        />
                        {socialLinksFormFieldNames().map(({ platform }) => (
                          <s-grid
                            key={platform}
                            gridTemplateColumns={GRID_2_COLS}
                            gap="base"
                          >
                            <s-text-field
                              label={`${SOCIAL_PLATFORM_LABELS[platform]} label (optional)`}
                              value={form.social[platform].label}
                              placeholder={SOCIAL_PLATFORM_LABELS[platform]}
                              onInput={(event: Event) =>
                                patchSocial(platform, "label", fieldValue(event))
                              }
                              onChange={(event: Event) =>
                                patchSocial(platform, "label", fieldValue(event))
                              }
                            />
                            <s-text-field
                              label={`${SOCIAL_PLATFORM_LABELS[platform]} URL (optional)`}
                              value={form.social[platform].url}
                              placeholder="https://example.com"
                              onInput={(event: Event) =>
                                patchSocial(platform, "url", fieldValue(event))
                              }
                              onChange={(event: Event) =>
                                patchSocial(platform, "url", fieldValue(event))
                              }
                            />
                          </s-grid>
                        ))}
                      </s-stack>
                    ) : null}
                  </s-stack>
                </s-query-container>
              </s-stack>
            </s-section>
          </s-grid>
        </s-query-container>
      </s-stack>
    </s-page>
  );
}

type SetupField =
  | HTMLElementTagNameMap["s-text-field"]
  | HTMLElementTagNameMap["s-email-field"]
  | HTMLElementTagNameMap["s-number-field"]
  | HTMLElementTagNameMap["s-select"];

function isSetupField(target: EventTarget | null): target is SetupField {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "S-TEXT-FIELD" ||
      target.tagName === "S-EMAIL-FIELD" ||
      target.tagName === "S-NUMBER-FIELD" ||
      target.tagName === "S-SELECT")
  );
}

function fieldValue(event: Event) {
  if (!isSetupField(event.currentTarget)) return "";
  return event.currentTarget.value ?? "";
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs)
};
