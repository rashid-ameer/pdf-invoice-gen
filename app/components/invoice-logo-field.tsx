import { useEffect, useId, useRef, useState } from "react";

import { MAX_LOGO_BYTES } from "../models/branding";

export const INVOICE_LOGO_MAX_BYTES = MAX_LOGO_BYTES;
export const INVOICE_LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
const INVOICE_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const URL_ERROR =
  "We couldn't load an image from this link. Check the link and try again.";
const FILE_ERROR = "Use a .png, .jpg, .jpeg, .webp, or .gif file up to 500 KB.";
const URL_HELPER =
  "Link to a .png, .jpg, .jpeg, .webp, or .gif image that is already hosted online.";
const DROP_HELPER =
  ".png, .jpg, .jpeg, .webp, or .gif · up to 500 KB · 400 × 400 px recommended";

export type InvoiceLogoSource = "upload" | "url";

export type InvoiceLogoValue = {
  src: string;
  source: InvoiceLogoSource | null;
  fileName: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  format: string | null;
};

type UrlPreview = {
  src: string;
  width: number;
  height: number;
  format: string;
};

type InvoiceLogoFieldProps = {
  value: InvoiceLogoValue;
  onChange: (next: InvoiceLogoValue) => void;
  /** Bump on discard / server sync to reset panels and the remove banner. */
  resetToken: number;
  disabled?: boolean;
  /**
   * Section heading. Default "Invoice logo" (Branding page).
   * Pass `null` when a parent already shows "Logo" (template Style tab).
   */
  heading?: string | null;
  subheading?: string | null;
};

export function emptyInvoiceLogo(): InvoiceLogoValue {
  return {
    src: "",
    source: null,
    fileName: "",
    width: null,
    height: null,
    bytes: null,
    format: null,
  };
}

export function invoiceLogoFromStoredUrl(logoUrl: string): InvoiceLogoValue {
  const src = logoUrl.trim();
  if (!src) return emptyInvoiceLogo();
  const source: InvoiceLogoSource = src.startsWith("data:") ? "upload" : "url";
  return {
    src,
    source,
    fileName: fileNameFromSrc(src, source),
    width: null,
    height: null,
    bytes: src.startsWith("data:") ? bytesFromDataUrl(src) : null,
    format: formatFromSrc(src),
  };
}

function bytesFromDataUrl(src: string): number | null {
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const payload = src.slice(comma + 1);
  return Math.ceil((payload.length * 3) / 4);
}

function formatFromSrc(src: string): string | null {
  if (src.startsWith("data:image/")) {
    const match = src.match(/^data:image\/([a-z0-9+.-]+)/i);
    return mimeToFormat(match?.[1] ?? "");
  }
  try {
    const path = new URL(src).pathname.toLowerCase();
    if (path.endsWith(".png")) return "PNG";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "JPG";
    if (path.endsWith(".webp")) return "WEBP";
    if (path.endsWith(".gif")) return "GIF";
  } catch {
    /* ignore */
  }
  return null;
}

function mimeToFormat(mime: string): string | null {
  const normalized = mime.toLowerCase();
  if (normalized === "png") return "PNG";
  if (normalized === "jpeg" || normalized === "jpg") return "JPG";
  if (normalized === "webp") return "WEBP";
  if (normalized === "gif") return "GIF";
  return normalized ? normalized.toUpperCase() : null;
}

function fileNameFromSrc(src: string, source: InvoiceLogoSource): string {
  if (source === "upload") {
    const format = formatFromSrc(src);
    return format ? `logo.${format.toLowerCase()}` : "logo";
  }
  try {
    const name = new URL(src).pathname.split("/").filter(Boolean).pop();
    if (name) return decodeURIComponent(name);
  } catch {
    /* ignore */
  }
  return "Image from URL";
}

function loadImageMeta(
  src: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => reject(new Error("load failed"));
    image.src = src;
  });
}

function isBareUrlPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === "" ||
    trimmed === "https://" ||
    trimmed === "https:/" ||
    trimmed === "http://" ||
    trimmed === "http:/"
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function validateFile(file: File): string | null {
  const typeOk =
    INVOICE_LOGO_TYPES.has(file.type) ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  if (!typeOk) return FILE_ERROR;
  if (file.size > INVOICE_LOGO_MAX_BYTES) return FILE_ERROR;
  return null;
}

export function InvoiceLogoField({
  value,
  onChange,
  resetToken,
  disabled = false,
  heading = "Invoice logo",
  subheading = "Shown at the top of your invoices.",
}: InvoiceLogoFieldProps) {
  const replaceMenuId = useId().replace(/:/g, "");
  const [panel, setPanel] = useState<"default" | "url" | "upload">("default");
  const [addMethod, setAddMethod] = useState<"upload" | "url">("upload");
  const [uploading, setUploading] = useState(false);
  const [dropError, setDropError] = useState("");
  const [dropZoneKey, setDropZoneKey] = useState(0);
  const [urlDraft, setUrlDraft] = useState("https://");
  const [urlStatus, setUrlStatus] = useState<
    "idle" | "loading" | "valid" | "invalid"
  >("idle");
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null);
  const urlRequestRef = useRef(0);

  useEffect(() => {
    setPanel("default");
    setAddMethod("upload");
    setUploading(false);
    setDropError("");
    setDropZoneKey((key) => key + 1);
    setUrlDraft("https://");
    setUrlStatus("idle");
    setUrlPreview(null);
  }, [resetToken]);

  const hasLogo = Boolean(value.src);
  const busy = disabled || uploading;
  const isReplacing = panel === "upload" || panel === "url";
  const showCompose =
    !uploading &&
    (isReplacing || (panel === "default" && !hasLogo));
  const showPreview = uploading || (panel === "default" && hasLogo);

  const applyLogo = (next: InvoiceLogoValue) => {
    setDropError("");
    setPanel("default");
    setAddMethod("upload");
    setUrlDraft("https://");
    setUrlStatus("idle");
    setUrlPreview(null);
    onChange(next);
  };

  const processFile = async (file: File) => {
    const error = validateFile(file);
    if (error) {
      setDropError(error);
      setDropZoneKey((key) => key + 1);
      return;
    }

    setDropError("");
    setUploading(true);
    setPanel("default");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith("data:image/")) {
        setDropError(FILE_ERROR);
        return;
      }
      let width: number | null = null;
      let height: number | null = null;
      try {
        const meta = await loadImageMeta(dataUrl);
        width = meta.width || null;
        height = meta.height || null;
      } catch {
        /* dimensions optional */
      }
      applyLogo({
        src: dataUrl,
        source: "upload",
        fileName: file.name || fileNameFromSrc(dataUrl, "upload"),
        width,
        height,
        bytes: file.size,
        format:
          formatFromSrc(dataUrl) ??
          mimeToFormat(file.type.replace("image/", "")),
      });
    } catch {
      setDropError(FILE_ERROR);
    } finally {
      setUploading(false);
      setDropZoneKey((key) => key + 1);
    }
  };

  const openUploadPanel = () => {
    if (busy) return;
    setDropError("");
    setDropZoneKey((key) => key + 1);
    setAddMethod("upload");
    setPanel("upload");
  };

  const openUrlPanel = () => {
    if (busy) return;
    setDropError("");
    setUrlDraft("https://");
    setUrlStatus("idle");
    setUrlPreview(null);
    setAddMethod("url");
    setPanel("url");
  };

  const cancelCompose = () => {
    setDropError("");
    setDropZoneKey((key) => key + 1);
    setUrlDraft("https://");
    setUrlStatus("idle");
    setUrlPreview(null);
    setAddMethod("upload");
    setPanel("default");
  };

  const clearUrlError = () => {
    if (urlStatus === "invalid") setUrlStatus("idle");
  };

  const selectAddMethod = (next: "upload" | "url") => {
    if (next === addMethod) return;
    if (next === "upload") {
      clearUrlError();
      setDropZoneKey((key) => key + 1);
    }
    setAddMethod(next);
    if (isReplacing) {
      setPanel(next === "url" ? "url" : "upload");
    }
  };

  const validateUrlDraft = async (raw: string) => {
    const requestId = ++urlRequestRef.current;
    const trimmed = raw.trim();

    if (isBareUrlPlaceholder(trimmed)) {
      if (requestId !== urlRequestRef.current) return;
      setUrlStatus("idle");
      setUrlPreview(null);
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      if (requestId !== urlRequestRef.current) return;
      setUrlStatus("invalid");
      setUrlPreview(null);
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      if (requestId !== urlRequestRef.current) return;
      setUrlStatus("invalid");
      setUrlPreview(null);
      return;
    }

    setUrlStatus("loading");
    setUrlPreview(null);
    try {
      const meta = await loadImageMeta(trimmed);
      if (requestId !== urlRequestRef.current) return;
      if (!meta.width && !meta.height) {
        if (parsed.protocol === "http:") {
          setUrlPreview({
            src: trimmed,
            width: 0,
            height: 0,
            format: formatFromSrc(trimmed) ?? "PNG",
          });
          setUrlStatus("valid");
          return;
        }
        setUrlStatus("invalid");
        setUrlPreview(null);
        return;
      }
      setUrlPreview({
        src: trimmed,
        width: meta.width,
        height: meta.height,
        format: formatFromSrc(trimmed) ?? "PNG",
      });
      setUrlStatus("valid");
    } catch {
      if (requestId !== urlRequestRef.current) return;
      // HTTPS admin often blocks http image preview (mixed content); server still accepts http.
      if (parsed.protocol === "http:") {
        setUrlPreview({
          src: trimmed,
          width: 0,
          height: 0,
          format: formatFromSrc(trimmed) ?? "PNG",
        });
        setUrlStatus("valid");
        return;
      }
      setUrlStatus("invalid");
      setUrlPreview(null);
    }
  };

  useEffect(() => {
    if (addMethod !== "url") return;
    const handle = window.setTimeout(() => {
      void validateUrlDraft(urlDraft);
    }, 500);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlDraft, addMethod]);

  const addUrlImage = () => {
    if (urlStatus !== "valid" || !urlPreview) return;
    applyLogo({
      src: urlPreview.src,
      source: "url",
      fileName: fileNameFromSrc(urlPreview.src, "url"),
      width: urlPreview.width,
      height: urlPreview.height,
      bytes: null,
      format: urlPreview.format,
    });
  };

  const removeLogo = () => {
    if (busy || !hasLogo) return;
    setDropError("");
    setAddMethod("upload");
    setPanel("default");
    onChange(emptyInvoiceLogo());
  };

  const uploadControls = (
    <s-stack gap="base">
      <s-choice-list
        label="Add logo using"
        name="invoiceLogoMethod"
        values={[addMethod]}
        onChange={(event: Event) => {
          const target = event.currentTarget as HTMLElement & {
            values?: string[];
          };
          const next = (target.values?.[0] ?? "upload") as "upload" | "url";
          selectAddMethod(next);
        }}
      >
        <s-choice value="upload">Upload from computer</s-choice>
        <s-choice value="url">Use image URL</s-choice>
      </s-choice-list>

      {addMethod === "upload" ? (
        <s-stack gap="base">
          <s-drop-zone
            key={dropZoneKey}
            label={heading ?? "Logo"}
            labelAccessibilityVisibility="exclusive"
            accept={INVOICE_LOGO_ACCEPT}
            accessibilityLabel="Add your company logo. PNG, JPG, JPEG, WebP, or GIF up to 500 KB."
            error={dropError || undefined}
            disabled={busy}
            onChange={(event: Event) => {
              const target = event.currentTarget as unknown as {
                files?: File[];
              };
              const file = target.files?.[0];
              if (file) void processFile(file);
            }}
            onDropRejected={() => {
              setDropError(FILE_ERROR);
              setDropZoneKey((key) => key + 1);
            }}
          >
            <s-stack gap="base" alignItems="center">
              <s-icon type="image" />
              <s-text>Click to upload</s-text>
              <s-text color="subdued">{DROP_HELPER}</s-text>
            </s-stack>
          </s-drop-zone>
          {isReplacing ? (
            <s-stack direction="inline" justifyContent="end">
              <s-button
                variant="secondary"
                onClick={cancelCompose}
                {...(busy ? { disabled: true } : {})}
              >
                Cancel
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      ) : (
        <s-stack gap="base">
          <s-text-field
            label="Image URL"
            value={urlDraft}
            placeholder="https://"
            details={URL_HELPER}
            error={urlStatus === "invalid" ? URL_ERROR : undefined}
            disabled={disabled}
            onInput={(event: Event) => {
              const next = (event.currentTarget as HTMLInputElement).value;
              setUrlDraft(next);
            }}
            onChange={(event: Event) => {
              const next = (event.currentTarget as HTMLInputElement).value;
              setUrlDraft(next);
            }}
            onBlur={() => {
              void validateUrlDraft(urlDraft);
            }}
          />

          {urlStatus === "loading" ? (
            <s-box
              inlineSize="96px"
              blockSize="96px"
              background="subdued"
              borderRadius="base"
            >
              <s-stack
                alignItems="center"
                justifyContent="center"
                blockSize="100%"
              >
                <s-spinner accessibilityLabel="Loading image preview" />
              </s-stack>
            </s-box>
          ) : null}

          {urlStatus === "valid" && urlPreview ? (
            <s-box inlineSize="96px" blockSize="96px" borderRadius="base">
              <s-image
                src={urlPreview.src}
                alt="Logo URL preview"
                aspectRatio="1/1"
                objectFit="contain"
                inlineSize="fill"
                borderRadius="base"
              />
            </s-box>
          ) : null}

          <s-stack direction="inline" gap="small-100" justifyContent="end">
            <s-button
              variant="secondary"
              onClick={() => {
                if (isReplacing) {
                  cancelCompose();
                  return;
                }
                selectAddMethod("upload");
                setUrlDraft("https://");
                setUrlStatus("idle");
                setUrlPreview(null);
              }}
              {...(disabled ? { disabled: true } : {})}
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              onClick={addUrlImage}
              {...(disabled || urlStatus !== "valid"
                ? { disabled: true }
                : {})}
            >
              Add image
            </s-button>
          </s-stack>
        </s-stack>
      )}
    </s-stack>
  );

  const body = (
    <s-stack gap="base">
      {showCompose ? (
        uploadControls
      ) : showPreview ? (
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-box
            inlineSize="112px"
            blockSize="112px"
            borderRadius="base"
            background="subdued"
          >
            {uploading || !value.src ? (
              <s-stack
                alignItems="center"
                justifyContent="center"
                blockSize="100%"
              >
                <s-spinner accessibilityLabel="Uploading logo" />
              </s-stack>
            ) : (
              <s-image
                src={value.src}
                alt={value.fileName || "Logo"}
                aspectRatio="1/1"
                objectFit="contain"
                inlineSize="fill"
                borderRadius="base"
              />
            )}
          </s-box>

          <s-stack direction="inline" gap="small-100">
            <s-button
              variant="secondary"
              commandFor={replaceMenuId}
              {...(busy ? { disabled: true } : {})}
            >
              Replace
            </s-button>
            <s-menu id={replaceMenuId} accessibilityLabel="Replace logo">
              <s-button icon="upload" onClick={openUploadPanel}>
                Upload from computer
              </s-button>
              <s-button icon="link" onClick={openUrlPanel}>
                Use image URL
              </s-button>
            </s-menu>
            <s-button
              variant="secondary"
              tone="critical"
              onClick={removeLogo}
              {...(busy ? { disabled: true } : {})}
            >
              Remove
            </s-button>
          </s-stack>
        </s-stack>
      ) : null}
    </s-stack>
  );

  if (heading == null) {
    return body;
  }

  return (
    <s-section
      heading={heading}
      {...(subheading ? { subheading } : {})}
    >
      {body}
    </s-section>
  );
}
