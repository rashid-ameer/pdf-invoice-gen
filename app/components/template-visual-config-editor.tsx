/**
 * Group 14 Phase B — visual template configuration editor (Style / Layout / Content / Fields).
 * Field set mirrors old `server/views/template-editor.ts` + `template-editor.js` collectConfig.
 * No Liquid editor (Phase C). No thumbnails (Phase D).
 */
import { useEffect, useMemo, useState } from "react";

import {
  emptyInvoiceLogo,
  invoiceLogoFromStoredUrl,
  InvoiceLogoField,
  type InvoiceLogoValue,
} from "./invoice-logo-field";
import type { DocumentType } from "../types/index";
import {
  FONT_FAMILIES,
  layoutEditorCapabilities,
  type BaseLayoutCode,
  type TemplateConfig,
} from "../models/template-config.types";

export type VisualConfigTab = "style" | "layout" | "content" | "fields";

const LAYOUT_LABELS: Record<BaseLayoutCode, string> = {
  modern: "Modern Minimal",
  professional: "Professional B2B",
  emirates: "Classic Stripe",
  canvas: "Canvas",
  tide: "Tide",
  folio: "Folio",
  bloom: "Bloom",
  iris: "Iris",
  haze: "Haze",
  ledger: "Ledger",
  noir: "Noir",
  slate: "Slate",
  charter: "Charter",
  matrix: "Matrix",
  ember: "Ember",
  summit: "Summit",
  flare: "Flare",
  vault: "Vault",
  beacon: "Beacon",
  onyx: "Onyx",
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

type Props = {
  config: TemplateConfig;
  onChange: (next: TemplateConfig) => void;
  baseLayoutCode: BaseLayoutCode;
  documentType: DocumentType;
  sourceType: string;
  disabled?: boolean;
  logoResetToken?: number;
};

export function TemplateVisualConfigEditor({
  config,
  onChange,
  baseLayoutCode,
  documentType,
  sourceType,
  disabled = false,
  logoResetToken = 0,
}: Props) {
  const [tab, setTab] = useState<VisualConfigTab>("style");
  const caps = useMemo(
    () => layoutEditorCapabilities(baseLayoutCode),
    [baseLayoutCode],
  );
  const isPackingSlip = documentType === "packing_slip";
  const isImported = sourceType === "imported";
  const showLayoutTab = !isImported;
  const primaryLang = config.language?.primary === "ar" ? "ar" : "en";
  const bilingual = Boolean(config.language?.showBilingual);
  const showEn = bilingual || primaryLang === "en";
  const showAr = bilingual || primaryLang === "ar";

  const patch = (updater: (draft: TemplateConfig) => void) => {
    if (disabled) return;
    const next = structuredClone(config);
    updater(next);
    // Old collectConfig: when secondary/accent controls are hidden, accent = primary.
    if (!caps.extraColors) {
      next.branding.accentColor = next.branding.primaryColor;
    }
    onChange(next);
  };

  const languageHint = bilingual
    ? "Bilingual documents show English and Arabic. Edit both sets of fields below."
    : primaryLang === "ar"
      ? "Arabic is the document language. Only Arabic content and labels are shown."
      : "English is the document language. Only English content and labels are shown.";

  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small">
        <TabButton
          active={tab === "style"}
          disabled={disabled}
          onClick={() => setTab("style")}
        >
          Style
        </TabButton>
        {showLayoutTab ? (
          <TabButton
            active={tab === "layout"}
            disabled={disabled}
            onClick={() => setTab("layout")}
          >
            Layout
          </TabButton>
        ) : null}
        <TabButton
          active={tab === "content"}
          disabled={disabled}
          onClick={() => setTab("content")}
        >
          Content
        </TabButton>
        <TabButton
          active={tab === "fields"}
          disabled={disabled}
          onClick={() => setTab("fields")}
        >
          Fields
        </TabButton>
      </s-stack>

      {!caps.codeEditor && !isImported ? (
        <s-banner tone="info" heading="Fixed layout">
          This layout keeps field positions fixed. Style, content, and fields
          still apply. Controls that would break this design are hidden.
        </s-banner>
      ) : null}

      {tab === "style" ? (
        <s-section
          heading="Style"
          subheading="Template-level colors and typography. Store Branding overrides logo and brand colors when documents are rendered."
        >
          <s-stack gap="base">
            <LogoEditor
              logoUrl={config.branding.logoUrl}
              resetToken={logoResetToken}
              disabled={disabled}
              onChange={(logoUrl) =>
                patch((d) => {
                  d.branding.logoUrl = logoUrl;
                })
              }
            />

            <s-query-container>
              <s-grid
                gridTemplateColumns="@container (inline-size > 480px) repeat(3, 1fr), 1fr"
                gap="base"
              >
                <ColorField
                  label="Primary"
                  fallback="#008060"
                  value={config.branding.primaryColor}
                  details="Headers, borders, tax strip"
                  disabled={disabled}
                  onChange={(value) =>
                    patch((d) => {
                      d.branding.primaryColor = value;
                    })
                  }
                />
                {caps.extraColors ? (
                  <>
                    <ColorField
                      label="Secondary"
                      fallback="#6d7175"
                      value={config.branding.secondaryColor}
                      details="Labels and supporting text"
                      disabled={disabled}
                      onChange={(value) =>
                        patch((d) => {
                          d.branding.secondaryColor = value;
                        })
                      }
                    />
                    <ColorField
                      label="Accent"
                      fallback="#004c3f"
                      value={config.branding.accentColor}
                      details="Totals and highlights"
                      disabled={disabled}
                      onChange={(value) =>
                        patch((d) => {
                          d.branding.accentColor = value;
                        })
                      }
                    />
                  </>
                ) : null}
              </s-grid>
            </s-query-container>

            <s-select
              label="Font family"
              value={config.typography.fontFamily}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const value = selectValue(event);
                if (!(FONT_FAMILIES as readonly string[]).includes(value)) {
                  return;
                }
                patch((d) => {
                  d.typography.fontFamily =
                    value as (typeof FONT_FAMILIES)[number];
                });
              }}
            >
              {FONT_FAMILIES.map((font) => (
                <s-option key={font} value={font}>
                  {font}
                </s-option>
              ))}
            </s-select>

            <s-number-field
              label="Base font size (px)"
              value={String(config.typography.baseFontSize)}
              min={10}
              max={14}
              step={1}
              details="10–14"
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const n = clampInt(fieldValue(event), 10, 14, 13);
                patch((d) => {
                  d.typography.baseFontSize = n;
                });
              }}
            />
            <s-number-field
              label="Heading size (px)"
              value={String(config.typography.headingFontSize)}
              min={18}
              max={32}
              step={1}
              details="18–32"
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const n = clampInt(fieldValue(event), 18, 32, 28);
                patch((d) => {
                  d.typography.headingFontSize = n;
                });
              }}
            />
            <s-number-field
              label="Label size (px)"
              value={String(config.typography.labelFontSize)}
              min={9}
              max={12}
              step={1}
              details="9–12"
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const n = clampInt(fieldValue(event), 9, 12, 11);
                patch((d) => {
                  d.typography.labelFontSize = n;
                });
              }}
            />
          </s-stack>
        </s-section>
      ) : null}

      {tab === "layout" && showLayoutTab ? (
        <s-section
          heading="Layout"
          subheading="Base layout is fixed after create. Start from Templates to pick a different layout."
        >
          <s-stack gap="base">
            <s-select
              label="Base layout"
              value={baseLayoutCode}
              disabled
            >
              <s-option value={baseLayoutCode}>
                {LAYOUT_LABELS[baseLayoutCode] ?? baseLayoutCode}
              </s-option>
            </s-select>

            {caps.headerStyle ? (
              <s-select
                label="Header style"
                value={config.layout.headerStyle}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const value = selectValue(event);
                  if (
                    value !== "minimal" &&
                    value !== "banner" &&
                    value !== "emirates"
                  ) {
                    return;
                  }
                  patch((d) => {
                    d.layout.headerStyle = value;
                  });
                }}
              >
                <s-option value="minimal">Minimal</s-option>
                <s-option value="banner">Banner</s-option>
                <s-option value="emirates">Classic stripe header</s-option>
              </s-select>
            ) : null}

            {caps.sellerBuyerLayout ? (
              <s-select
                label="Seller / buyer layout"
                value={config.layout.sellerBuyerLayout}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const value = selectValue(event);
                  if (value !== "side-by-side" && value !== "stacked") return;
                  patch((d) => {
                    d.layout.sellerBuyerLayout = value;
                  });
                }}
              >
                <s-option value="side-by-side">Side by side</s-option>
                <s-option value="stacked">Stacked</s-option>
              </s-select>
            ) : (
              <s-text color="subdued">
                Field placement is fixed on this layout. Stacked seller/buyer is
                not used.
              </s-text>
            )}

            {caps.logoPosition ? (
              <s-select
                label="Logo position"
                value={config.layout.logoPosition}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const value = selectValue(event);
                  if (value !== "left" && value !== "center") return;
                  patch((d) => {
                    d.layout.logoPosition = value;
                  });
                }}
              >
                <s-option value="left">Left</s-option>
                <s-option value="center">Center</s-option>
              </s-select>
            ) : null}

            {caps.taxBadge ? (
              <s-checkbox
                label="Show tax supplier badge"
                checked={Boolean(config.layout.showTaxBadge)}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const checked = (event.currentTarget as HTMLInputElement)
                    .checked;
                  patch((d) => {
                    d.layout.showTaxBadge = checked;
                  });
                }}
              />
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {tab === "content" ? (
        <s-section heading="Content" subheading="Titles, notes, terms, footer, and labels.">
          <s-stack gap="base">
            <s-select
              label="Language"
              value={primaryLang}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const value = selectValue(event);
                if (value !== "en" && value !== "ar") return;
                patch((d) => {
                  d.language = {
                    primary: value,
                    showBilingual: Boolean(d.language?.showBilingual),
                  };
                });
              }}
            >
              <s-option value="en">English</s-option>
              <s-option value="ar">Arabic</s-option>
            </s-select>

            <s-checkbox
              label="Show bilingual (English + Arabic)"
              checked={bilingual}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.language = {
                    primary: d.language?.primary === "ar" ? "ar" : "en",
                    showBilingual: checked,
                  };
                });
              }}
            />
            <s-text color="subdued">{languageHint}</s-text>

            {showEn ? (
              <s-stack gap="base">
                <s-heading>English content</s-heading>
                {caps.documentTitle ? (
                  <HtmlArea
                    label="Document title"
                    value={config.content.documentTitle.html}
                    disabled={disabled}
                    onChange={(html) =>
                      patch((d) => {
                        d.content.documentTitle = { html };
                      })
                    }
                  />
                ) : null}
                {caps.documentSubtitle ? (
                  <HtmlArea
                    label="Subtitle"
                    value={config.content.subtitle.html}
                    disabled={disabled}
                    onChange={(html) =>
                      patch((d) => {
                        d.content.subtitle = { html };
                      })
                    }
                  />
                ) : null}
                <HtmlArea
                  label="Custom note"
                  details="Shown only when Fields → Notes is on and this box has text."
                  value={config.content.customNote.html}
                  disabled={disabled}
                  onChange={(html) =>
                    patch((d) => {
                      d.content.customNote = { html };
                    })
                  }
                />
                <HtmlArea
                  label="Terms / payment info"
                  details="Shown only when Fields → Terms & conditions is on and this box has text."
                  value={config.content.terms.html}
                  disabled={disabled}
                  onChange={(html) =>
                    patch((d) => {
                      d.content.terms = { html };
                    })
                  }
                />
                <HtmlArea
                  label="Footer"
                  value={config.content.footer.html}
                  disabled={disabled}
                  onChange={(html) =>
                    patch((d) => {
                      d.content.footer = { html };
                    })
                  }
                />
                <s-heading>English labels</s-heading>
                {caps.sellerLabel ? (
                  <s-text-field
                    label={isPackingSlip ? "From label" : "Seller label"}
                    value={
                      config.labels.seller ??
                      (isPackingSlip ? "From" : "Seller")
                    }
                    {...(disabled ? { disabled: true } : {})}
                    onInput={(event: Event) => {
                      const value = fieldValue(event);
                      patch((d) => {
                        d.labels.seller = value;
                      });
                    }}
                  />
                ) : null}
                <s-text-field
                  label={isPackingSlip ? "Ship-to label" : "Buyer label"}
                  value={
                    config.labels.buyer ??
                    (isPackingSlip ? "Ship To" : "Buyer")
                  }
                  {...(disabled ? { disabled: true } : {})}
                  onInput={(event: Event) => {
                    const value = fieldValue(event);
                    patch((d) => {
                      d.labels.buyer = value;
                    });
                  }}
                />
              </s-stack>
            ) : null}

            {showAr ? (
              <s-stack gap="base">
                <s-heading>Arabic content</s-heading>
                {caps.documentTitle ? (
                  <HtmlArea
                    label="Document title"
                    value={config.translations?.documentTitle?.html ?? ""}
                    disabled={disabled}
                    dir="rtl"
                    onChange={(html) =>
                      patch((d) => {
                        ensureTranslations(d);
                        d.translations!.documentTitle = { html };
                      })
                    }
                  />
                ) : null}
                {caps.documentSubtitle ? (
                  <HtmlArea
                    label="Subtitle"
                    value={config.translations?.subtitle?.html ?? ""}
                    disabled={disabled}
                    dir="rtl"
                    onChange={(html) =>
                      patch((d) => {
                        ensureTranslations(d);
                        d.translations!.subtitle = { html };
                      })
                    }
                  />
                ) : null}
                <HtmlArea
                  label="Footer"
                  value={config.translations?.footer?.html ?? ""}
                  disabled={disabled}
                  dir="rtl"
                  onChange={(html) =>
                    patch((d) => {
                      ensureTranslations(d);
                      d.translations!.footer = { html };
                    })
                  }
                />
                <s-heading>Arabic labels</s-heading>
                {caps.sellerLabel ? (
                  <s-text-field
                    label={isPackingSlip ? "From" : "Seller"}
                    value={config.translations?.labels?.seller ?? ""}
                    {...(disabled ? { disabled: true } : {})}
                    onInput={(event: Event) => {
                      const value = fieldValue(event);
                      patch((d) => {
                        ensureTranslations(d);
                        d.translations!.labels = {
                          ...(d.translations!.labels ?? {}),
                          seller: value,
                        };
                      });
                    }}
                  />
                ) : null}
                <s-text-field
                  label={isPackingSlip ? "Ship-to" : "Buyer"}
                  value={config.translations?.labels?.buyer ?? ""}
                  {...(disabled ? { disabled: true } : {})}
                  onInput={(event: Event) => {
                    const value = fieldValue(event);
                    patch((d) => {
                      ensureTranslations(d);
                      d.translations!.labels = {
                        ...(d.translations!.labels ?? {}),
                        buyer: value,
                      };
                    });
                  }}
                />
                <s-text-field
                  label="Invoice number"
                  value={config.translations?.labels?.invoiceNumber ?? ""}
                  {...(disabled ? { disabled: true } : {})}
                  onInput={(event: Event) => {
                    const value = fieldValue(event);
                    patch((d) => {
                      ensureTranslations(d);
                      d.translations!.labels = {
                        ...(d.translations!.labels ?? {}),
                        invoiceNumber: value,
                      };
                    });
                  }}
                />
                <s-text-field
                  label="Grand total"
                  value={config.translations?.labels?.grandTotal ?? ""}
                  {...(disabled ? { disabled: true } : {})}
                  onInput={(event: Event) => {
                    const value = fieldValue(event);
                    patch((d) => {
                      ensureTranslations(d);
                      d.translations!.labels = {
                        ...(d.translations!.labels ?? {}),
                        grandTotal: value,
                      };
                    });
                  }}
                />
              </s-stack>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {tab === "fields" ? (
        <s-section heading="Fields" subheading="Section and column visibility.">
          <s-stack gap="base">
            <s-heading>
              {isPackingSlip
                ? "From / Ship To"
                : "Seller (TRN & legal name are required)"}
            </s-heading>
            {isPackingSlip ? (
              <>
                <s-checkbox
                  label="Show TRN"
                  checked={Boolean(config.sections.seller.fields.trn)}
                  {...(disabled ? { disabled: true } : {})}
                  onChange={(event: Event) => {
                    const checked = (event.currentTarget as HTMLInputElement)
                      .checked;
                    patch((d) => {
                      d.sections.seller.fields.trn = checked;
                    });
                  }}
                />
                <s-checkbox
                  label="Trade licence"
                  checked={Boolean(config.sections.seller.fields.tradeLicence)}
                  {...(disabled ? { disabled: true } : {})}
                  onChange={(event: Event) => {
                    const checked = (event.currentTarget as HTMLInputElement)
                      .checked;
                    patch((d) => {
                      d.sections.seller.fields.tradeLicence = checked;
                    });
                  }}
                />
              </>
            ) : (
              <>
                <s-checkbox
                  label="Legal name & TRN (locked)"
                  checked
                  disabled
                />
                <s-checkbox
                  label="Trade licence"
                  checked={Boolean(config.sections.seller.fields.tradeLicence)}
                  {...(disabled ? { disabled: true } : {})}
                  onChange={(event: Event) => {
                    const checked = (event.currentTarget as HTMLInputElement)
                      .checked;
                    patch((d) => {
                      d.sections.seller.fields.tradeLicence = checked;
                    });
                  }}
                />
              </>
            )}

            <s-checkbox
              label={`Show ${isPackingSlip ? "ship-to" : "buyer"} section`}
              checked={Boolean(config.sections.buyer.visible)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.buyer.visible = checked;
                });
              }}
            />
            <s-checkbox
              label={`${isPackingSlip ? "Customer" : "Buyer"} email`}
              checked={Boolean(config.sections.buyer.fields.email)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.buyer.fields.email = checked;
                });
              }}
            />
            <s-checkbox
              label={`${isPackingSlip ? "Shipping" : "Buyer"} address`}
              checked={Boolean(config.sections.buyer.fields.address)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.buyer.fields.address = checked;
                });
              }}
            />

            <s-heading>Line item columns</s-heading>
            <s-checkbox
              label="SKU"
              checked={Boolean(config.sections.lineItems.columns.sku)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.lineItems.columns.sku = checked;
                });
              }}
            />
            <s-checkbox
              label="Quantity"
              checked={Boolean(config.sections.lineItems.columns.quantity)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.lineItems.columns.quantity = checked;
                });
              }}
            />
            <s-checkbox
              label="Unit price"
              checked={Boolean(config.sections.lineItems.columns.unitPrice)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.lineItems.columns.unitPrice = checked;
                });
              }}
            />
            <s-checkbox
              label="Discount %"
              checked={config.sections.lineItems.columns.discount !== false}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.lineItems.columns.discount = checked;
                });
              }}
            />
            {isPackingSlip ? (
              <s-checkbox
                label="VAT %"
                checked={Boolean(config.sections.lineItems.columns.vatRate)}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const checked = (event.currentTarget as HTMLInputElement)
                    .checked;
                  patch((d) => {
                    d.sections.lineItems.columns.vatRate = checked;
                  });
                }}
              />
            ) : (
              <s-checkbox label="VAT % (locked)" checked disabled />
            )}
            <s-checkbox
              label="Line total"
              checked={Boolean(config.sections.lineItems.columns.lineTotal)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.lineItems.columns.lineTotal = checked;
                  d.sections.lineItems.columns.vatAmount = false;
                });
              }}
            />

            {caps.productDisplay ? (
              <>
                <s-heading>Product display</s-heading>
                <s-checkbox
                  label="Product titles"
                  checked={
                    config.sections.lineItems.columns.productTitle !== false
                  }
                  {...(disabled ? { disabled: true } : {})}
                  onChange={(event: Event) => {
                    const checked = (event.currentTarget as HTMLInputElement)
                      .checked;
                    patch((d) => {
                      d.sections.lineItems.columns.productTitle = checked;
                    });
                  }}
                />
                <s-checkbox
                  label="Product images"
                  checked={
                    config.sections.lineItems.columns.productImage === true
                  }
                  {...(disabled ? { disabled: true } : {})}
                  onChange={(event: Event) => {
                    const checked = (event.currentTarget as HTMLInputElement)
                      .checked;
                    patch((d) => {
                      d.sections.lineItems.columns.productImage = checked;
                    });
                  }}
                />
                <s-checkbox
                  label="Product barcodes"
                  checked={config.sections.lineItems.columns.barcode === true}
                  {...(disabled ? { disabled: true } : {})}
                  onChange={(event: Event) => {
                    const checked = (event.currentTarget as HTMLInputElement)
                      .checked;
                    patch((d) => {
                      d.sections.lineItems.columns.barcode = checked;
                    });
                  }}
                />
              </>
            ) : null}

            <s-heading>Totals</s-heading>
            {isPackingSlip ? (
              <s-checkbox
                label="Show totals section"
                checked={Boolean(config.sections.totals.visible)}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const checked = (event.currentTarget as HTMLInputElement)
                    .checked;
                  patch((d) => {
                    d.sections.totals.visible = checked;
                  });
                }}
              />
            ) : null}
            <s-checkbox
              label="Subtotal"
              checked={Boolean(config.sections.totals.showSubtotal)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.totals.showSubtotal = checked;
                });
              }}
            />
            <s-checkbox
              label="Discount"
              checked={Boolean(config.sections.totals.showDiscount)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.totals.showDiscount = checked;
                });
              }}
            />
            {isPackingSlip ? (
              <s-checkbox
                label="VAT total"
                checked={Boolean(config.sections.totals.showVat)}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const checked = (event.currentTarget as HTMLInputElement)
                    .checked;
                  patch((d) => {
                    d.sections.totals.showVat = checked;
                  });
                }}
              />
            ) : (
              <s-checkbox label="VAT total (locked)" checked disabled />
            )}
            <s-checkbox
              label="Shipping"
              checked={Boolean(config.sections.totals.showShipping)}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.sections.totals.showShipping = checked;
                });
              }}
            />
            {isPackingSlip ? (
              <s-checkbox
                label="Grand total"
                checked={Boolean(config.sections.totals.showGrandTotal)}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const checked = (event.currentTarget as HTMLInputElement)
                    .checked;
                  patch((d) => {
                    d.sections.totals.showGrandTotal = checked;
                  });
                }}
              />
            ) : (
              <s-checkbox label="Grand total (locked)" checked disabled />
            )}

            <s-heading>Extra blocks</s-heading>
            {caps.qrCode ? (
              <s-checkbox
                label="Authenticity QR code"
                checked={Boolean(config.sections.qrCode?.visible)}
                {...(disabled ? { disabled: true } : {})}
                onChange={(event: Event) => {
                  const checked = (event.currentTarget as HTMLInputElement)
                    .checked;
                  patch((d) => {
                    d.sections.qrCode = { visible: checked };
                  });
                }}
              />
            ) : null}
            <s-checkbox
              label="Notes"
              checked={config.content.showNotes !== false}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.content.showNotes = checked;
                });
              }}
            />
            <s-checkbox
              label="Terms & conditions"
              checked={config.content.showTerms !== false}
              {...(disabled ? { disabled: true } : {})}
              onChange={(event: Event) => {
                const checked = (event.currentTarget as HTMLInputElement)
                  .checked;
                patch((d) => {
                  d.content.showTerms = checked;
                });
              }}
            />
            <s-text color="subdued">
              Empty notes, terms, emails, and similar fields are omitted on the
              document — the label is hidden too.
            </s-text>
          </s-stack>
        </s-section>
      ) : null}
    </s-stack>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <s-button
      variant={active ? "primary" : "secondary"}
      onClick={onClick}
      {...(disabled ? { disabled: true } : {})}
    >
      {children}
    </s-button>
  );
}

function HtmlArea({
  label,
  value,
  details,
  disabled,
  dir,
  onChange,
}: {
  label: string;
  value: string;
  details?: string;
  disabled?: boolean;
  dir?: "rtl" | "ltr";
  onChange: (html: string) => void;
}) {
  return (
    <s-text-area
      label={label}
      value={value}
      rows={3}
      maxLength={5000}
      details={
        details
          ? `${details} HTML allowed (bold/italic/underline).`
          : "HTML allowed (bold/italic/underline)."
      }
      {...(dir ? { dir } : {})}
      {...(disabled ? { disabled: true } : {})}
      onInput={(event: Event) => onChange(fieldValue(event))}
      onChange={(event: Event) => onChange(fieldValue(event))}
    />
  );
}

function LogoEditor({
  logoUrl,
  resetToken,
  disabled,
  onChange,
}: {
  logoUrl: string;
  resetToken: number;
  disabled?: boolean;
  onChange: (logoUrl: string) => void;
}) {
  const [logo, setLogo] = useState<InvoiceLogoValue>(() =>
    invoiceLogoFromStoredUrl(logoUrl),
  );

  // Keep local logo control in sync when parent resets (discard / reload).
  useEffect(() => {
    setLogo(invoiceLogoFromStoredUrl(logoUrl));
  }, [resetToken, logoUrl]);

  if (disabled) {
    return (
      <s-text-field
        label="Logo URL"
        value={logoUrl.startsWith("data:") ? "" : logoUrl}
        disabled
        details="Template-level logo. Store Branding overrides on rendered documents."
      />
    );
  }

  return (
    <InvoiceLogoField
      value={logo.src ? logo : emptyInvoiceLogo()}
      resetToken={resetToken}
      onChange={(next) => {
        setLogo(next);
        onChange(next.src);
      }}
    />
  );
}

function ColorField({
  label,
  fallback,
  value,
  details,
  disabled,
  onChange,
}: {
  label: string;
  fallback: string;
  value: string;
  details: string;
  disabled?: boolean;
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
      {...(disabled ? { disabled: true } : {})}
      onInput={applyPicker}
      onChange={applyPicker}
    />
  );
}

function ensureTranslations(d: TemplateConfig) {
  if (!d.translations) {
    d.translations = {
      documentTitle: { html: "" },
      subtitle: { html: "" },
      footer: { html: "" },
      labels: {},
    };
  }
  if (!d.translations.labels) d.translations.labels = {};
}

function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

type FieldEl =
  | HTMLElementTagNameMap["s-text-field"]
  | HTMLElementTagNameMap["s-text-area"]
  | HTMLElementTagNameMap["s-color-field"]
  | HTMLElementTagNameMap["s-number-field"]
  | HTMLElementTagNameMap["s-select"];

function isField(target: EventTarget | null): target is FieldEl {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "S-TEXT-FIELD" ||
      target.tagName === "S-TEXT-AREA" ||
      target.tagName === "S-COLOR-FIELD" ||
      target.tagName === "S-NUMBER-FIELD" ||
      target.tagName === "S-SELECT")
  );
}

function fieldValue(event: Event): string {
  const target = event.currentTarget ?? event.target;
  if (!isField(target)) return "";
  return target.value ?? "";
}

function selectValue(event: Event): string {
  return fieldValue(event);
}
