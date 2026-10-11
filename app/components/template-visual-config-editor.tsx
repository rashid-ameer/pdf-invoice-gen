/**
 * Group 14 — visual template configuration editor (Style / Layout / Content / Fields).
 * Field set mirrors old `server/views/template-editor.ts` + `template-editor.js` collectConfig.
 * Content rich-text uses contenteditable + B/I/U like the old RTE (not Quill).
 */
import { useEffect, useMemo, useRef, useState } from "react";

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
      <s-grid
        gridTemplateColumns="repeat(4, auto)"
        gap="small-200"
        alignItems="center"
        justifyContent="start"
        accessibilityLabel="Editor options"
      >
        {(
          [
            ["style", "Style"],
            ["layout", "Layout"],
            ["content", "Content"],
            ["fields", "Fields"],
          ] as const
        ).map(([value, label]) => {
          const selected = tab === value;
          return (
            <s-clickable
              key={value}
              paddingBlock="small-200"
              paddingInline="large"
              border="none"
              borderRadius="base"
              background={selected ? "subdued" : "transparent"}
              accessibilityLabel={`${label}${selected ? ", selected" : ""}`}
              onClick={() => setTab(value)}
            >
              <s-text type="strong" fontWeight="semibold">{label}</s-text>
            </s-clickable>
          );
        })}
      </s-grid>

      <s-divider />

      {tab === "layout" && (!caps.codeEditor || isImported) ? (
        <s-banner tone="info">
          The layout of this template is fixed. You can still change its style,
          content, and fields.
        </s-banner>
      ) : null}

      {tab === "style" ? (
        <s-stack gap="base">
          <s-stack gap="base">
            <s-heading>Logo</s-heading>
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
          </s-stack>

          <s-divider />

          <s-stack gap="base">
            <s-heading>Colors</s-heading>
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
          </s-stack>

          <s-divider />

          <s-stack gap="base">
            <s-heading>Typography</s-heading>
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
        </s-stack>
      ) : null}

      {tab === "layout" && showLayoutTab && caps.codeEditor ? (
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
      ) : null}

      {tab === "content" ? (
        <s-stack gap="base">
          <s-stack gap="base">
            <s-heading>Language</s-heading>
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
          </s-stack>

          {showEn ? (
            <>
              <s-divider />
              <s-stack gap="base">
                <s-heading>English content</s-heading>
                {caps.documentTitle ? (
                  <HtmlArea
                    label="Document title"
                    value={config.content.documentTitle.html}
                    disabled={disabled}
                    toolbar
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
                    toolbar
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
                  toolbar
                  onChange={(html) =>
                    patch((d) => {
                      d.content.footer = { html };
                    })
                  }
                />
              </s-stack>

              <s-divider />
              <s-stack gap="base">
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
            </>
          ) : null}

          {showAr ? (
            <>
              <s-divider />
              <s-stack gap="base">
                <s-heading>Arabic content</s-heading>
                {caps.documentTitle ? (
                  <HtmlArea
                    label="Document title"
                    value={config.translations?.documentTitle?.html ?? ""}
                    disabled={disabled}
                    dir="rtl"
                    toolbar
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
              </s-stack>

              <s-divider />
              <s-stack gap="base">
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
            </>
          ) : null}
        </s-stack>
      ) : null}

      {tab === "fields" ? (
        <s-stack gap="base">
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

          </s-stack>

          <s-divider />
          <s-stack gap="base">
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

          </s-stack>

          {caps.productDisplay ? (
            <>
              <s-divider />
              <s-stack gap="base">
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
              </s-stack>
            </>
          ) : null}

          <s-divider />
          <s-stack gap="base">
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

          </s-stack>

          <s-divider />
          <s-stack gap="base">
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
        </s-stack>
      ) : null}
    </s-stack>
  );
}

type RteCmd = "bold" | "italic" | "underline";

/** Old `rte-toolbar` / `rte-btn` / `rte-editor` from template-editor.ts */
const RTE_CSS = `
.tpl-rte-toolbar {
  display: flex;
  gap: 3px;
  margin-bottom: 6px;
  flex-wrap: wrap;
  user-select: none;
}
.tpl-rte-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid #d2d5d8;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 0.72rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #444;
  transition: all 0.12s ease;
  user-select: none;
}
.tpl-rte-btn:hover { background: #f1f2f3; border-color: #8c9196; }
.tpl-rte-btn.active { background: #303030; color: #fff; border-color: #303030; }
.tpl-rte-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tpl-rte-editor {
  min-height: 56px;
  padding: 10px;
  border: 1px solid #c9cccf;
  border-radius: 8px;
  font-size: 0.9rem;
  background: #fff;
  font-weight: 400;
  line-height: 1.4;
  outline: none;
  overflow: auto;
}
.tpl-rte-editor:focus { outline: 2px solid #005bd3; outline-offset: 1px; }
.tpl-rte-editor p { margin: 0; }
.tpl-rte-editor strong, .tpl-rte-editor b { font-weight: 700 !important; }
.tpl-rte-editor em, .tpl-rte-editor i { font-style: italic !important; }
.tpl-rte-editor u { text-decoration: underline !important; }
.tpl-rte-editor.rtl {
  text-align: right;
  font-family: "Segoe UI", Tahoma, sans-serif;
}
`;

function HtmlArea({
  label,
  value,
  details,
  disabled,
  dir,
  toolbar = false,
  onChange,
}: {
  label: string;
  value: string;
  details?: string;
  disabled?: boolean;
  dir?: "rtl" | "ltr";
  /** Old app: title/subtitle/footer (EN) + AR title had B/I/U; note/terms did not. */
  toolbar?: boolean;
  onChange: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<Range | null>(null);
  const styleWithCssReady = useRef(false);
  const lastEmitted = useRef(value);
  const [active, setActive] = useState<Record<RteCmd, boolean>>({
    bold: false,
    italic: false,
    underline: false,
  });

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (value === lastEmitted.current) return;
    el.innerHTML = value || "";
    lastEmitted.current = value;
  }, [value]);

  const emit = () => {
    const el = editorRef.current;
    if (!el || disabled) return;
    const html = el.innerHTML;
    if (html === lastEmitted.current) return;
    lastEmitted.current = html;
    onChange(html);
  };

  const editorContains = (editor: HTMLElement, node: Node | null) => {
    if (!node) return false;
    if (node === editor) return true;
    return typeof editor.contains === "function"
      ? editor.contains(node)
      : false;
  };

  const saveSelection = () => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editorContains(editor, range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  };

  const selectAll = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRange.current = range.cloneRange();
  };

  const restoreSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    if (!styleWithCssReady.current) {
      try {
        document.execCommand("styleWithCSS", false, "false");
      } catch {
        /* ignore */
      }
      styleWithCssReady.current = true;
    }
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRange.current) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange.current);
      } catch {
        selectAll();
        return;
      }
    }
    if (sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) {
      selectAll();
    }
  };

  const wrapSelection = (cmd: RteCmd) => {
    const tag = cmd === "bold" ? "strong" : cmd === "italic" ? "em" : "u";
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const node = document.createElement(tag);
    try {
      range.surroundContents(node);
    } catch {
      node.appendChild(range.extractContents());
      range.insertNode(node);
    }
    sel.removeAllRanges();
    const next = document.createRange();
    next.selectNodeContents(node);
    sel.addRange(next);
    savedRange.current = next.cloneRange();
  };

  const applyFormat = (cmd: RteCmd) => {
    if (disabled) return;
    restoreSelection();
    let before = false;
    try {
      before = document.queryCommandState(cmd);
    } catch {
      before = false;
    }
    let ok = false;
    try {
      ok = document.execCommand(cmd, false);
    } catch {
      ok = false;
    }
    let after = before;
    try {
      after = document.queryCommandState(cmd);
    } catch {
      /* ignore */
    }
    if (!ok || after === before) {
      wrapSelection(cmd);
    }
    saveSelection();
    updateActive();
    emit();
  };

  const updateActive = () => {
    if (!toolbar) return;
    const next = { bold: false, italic: false, underline: false };
    for (const cmd of ["bold", "italic", "underline"] as const) {
      try {
        next[cmd] = document.queryCommandState(cmd);
      } catch {
        next[cmd] = false;
      }
    }
    setActive(next);
  };

  const hint =
    details ??
    (toolbar
      ? "Use the buttons for bold, italic, and underline."
      : "HTML allowed (bold/italic/underline).");

  return (
    <s-stack gap="small-200">
      <s-text type="strong">{label}</s-text>
      {toolbar ? (
        <div
          className="tpl-rte-toolbar"
          role="toolbar"
          aria-label={`${label} formatting`}
        >
          {(
            [
              ["bold", "B", "Bold"],
              ["italic", "I", "Italic"],
              ["underline", "U", "Underline"],
            ] as const
          ).map(([cmd, letter, title]) => (
            <button
              key={cmd}
              type="button"
              className={`tpl-rte-btn${active[cmd] ? " active" : ""}`}
              title={title}
              aria-label={title}
              aria-pressed={active[cmd]}
              disabled={disabled}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => applyFormat(cmd)}
            >
              {cmd === "italic" ? (
                <i>{letter}</i>
              ) : cmd === "underline" ? (
                <u>{letter}</u>
              ) : (
                <b>{letter}</b>
              )}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={(node) => {
          editorRef.current = node;
          if (
            node &&
            node.innerHTML !== (value || "") &&
            !node.contains(document.activeElement)
          ) {
            node.innerHTML = value || "";
            lastEmitted.current = value;
          }
        }}
        className={`tpl-rte-editor${dir === "rtl" ? " rtl" : ""}`}
        contentEditable={disabled ? false : true}
        suppressContentEditableWarning
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        dir={dir}
        onInput={emit}
        onBlur={emit}
        onKeyUp={() => {
          saveSelection();
          updateActive();
        }}
        onMouseUp={() => {
          saveSelection();
          updateActive();
        }}
        onFocus={() => {
          saveSelection();
          updateActive();
        }}
        style={disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
      />
      {hint ? <s-text color="subdued">{hint}</s-text> : null}
      <style>{RTE_CSS}</style>
    </s-stack>
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

function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (HEX_COLOR.test(trimmed)) return trimmed.toLowerCase();
  // s-color-field may emit #rgb
  const short = trimmed.match(/^#([0-9A-Fa-f]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
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
  const pickerValue = normalizeHexColor(value) ?? fallback;
  const applyPicker = (event: Event) => {
    const next = normalizeHexColor(fieldValue(event));
    if (!next) return;
    if (next === normalizeHexColor(value)) return;
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
