/**
 * Shared Templates gallery card + preview.
 * Layout, badges, buttons, selected style, and delete rules must stay identical
 * to the previous inline implementation on the Templates list page.
 * Thumbnail click opens a large read-only preview modal (Shopify App Home pattern).
 */
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

import type { TemplateListItem } from "../models/template.server";

export const DELETE_MODAL_ID = "delete-template-modal";
export const DELETE_DISABLED_TOOLTIP_ID = "delete-selected-template-tooltip";

/** Stable per-template id for the gallery preview overlay. */
export function templatePreviewModalId(templateId: string): string {
  return `template-preview-modal-${templateId}`;
}

/** 1 col mobile → 2 tablet → 3 desktop (container-query range syntax). */
export const CARD_GRID_COLUMNS =
  "@container (inline-size < 560px) 1fr, (560px <= inline-size < 768px) 1fr 1fr, 1fr 1fr 1fr";

export function TemplateCard({
  item,
  selectLoading,
  onEdit,
  onSelect,
  onRequestDelete,
}: {
  item: TemplateListItem;
  selectLoading: boolean;
  onEdit: () => void;
  onSelect: () => void;
  onRequestDelete: () => void;
}) {
  const isSelected = item.isDefault;
  const deleteDisabled = isSelected;
  const actionColumns = item.isCustom ? "1fr 1fr auto" : "1fr 1fr";
  const previewModalId = templatePreviewModalId(item.id);

  return (
    <>
      <s-section
        padding="base"
        accessibilityLabel={`${item.name}${isSelected ? ", selected" : ""}`}
      >
        <s-stack gap="base">
          <s-clickable
            accessibilityLabel={`Preview ${item.name}`}
            borderRadius="base"
            commandFor={previewModalId}
            command="--show"
          >
            <TemplatePreview
              dataUrl={item.thumbnailDataUrl}
              fetchUrl={item.thumbnailUrl}
              name={item.name}
            />
          </s-clickable>

          <s-stack gap="small-200">
            <s-heading lineClamp={1}>{item.name}</s-heading>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone="neutral">
                {item.isSystem ? "System" : "Custom"}
              </s-badge>
              {isSelected ? <s-badge tone="success">Selected</s-badge> : null}
            </s-stack>
          </s-stack>

          <s-grid gridTemplateColumns={actionColumns} gap="small-200">
            <s-button variant="secondary" inlineSize="fill" onClick={onEdit}>
              Edit
            </s-button>
            {isSelected ? (
              <s-button variant="secondary" inlineSize="fill" disabled>
                Selected
              </s-button>
            ) : (
              <s-button
                variant="secondary"
                inlineSize="fill"
                onClick={onSelect}
                {...(selectLoading ? { loading: true } : {})}
              >
                Select
              </s-button>
            )}
            {item.isCustom ? (
              <s-button
                icon="delete"
                variant="secondary"
                tone="critical"
                inlineSize="fill"
                accessibilityLabel={`Delete ${item.name}`}
                {...(deleteDisabled
                  ? {
                      disabled: true,
                      interestFor: DELETE_DISABLED_TOOLTIP_ID,
                    }
                  : {
                      commandFor: DELETE_MODAL_ID,
                      command: "--show" as const,
                      onClick: onRequestDelete,
                    })}
              />
            ) : null}
          </s-grid>
        </s-stack>
      </s-section>

      <s-modal
        id={previewModalId}
        heading={item.name}
        size="large"
        accessibilityLabel={`Preview of ${item.name}`}
      >
        <TemplatePreview
          dataUrl={item.thumbnailDataUrl}
          fetchUrl={item.thumbnailUrl}
          name={item.name}
          objectFit="contain"
        />
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor={previewModalId}
          command="--hide"
        >
          Close
        </s-button>
      </s-modal>
    </>
  );
}

/**
 * List thumbnail: prefer cached data URL from the loader (no auth needed).
 * Otherwise fetch JPEG with App Bridge Bearer. Always reserve 3/4 space so
 * gallery cards do not collapse while the image loads.
 */
export function TemplatePreview({
  dataUrl,
  fetchUrl,
  name,
  objectFit = "cover",
}: {
  dataUrl: string | null;
  fetchUrl: string;
  name: string;
  /** Gallery cards keep `cover`; overview / modal use `contain`. */
  objectFit?: "cover" | "contain";
}) {
  const shopify = useAppBridge();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (dataUrl) {
      setObjectUrl(null);
      setFetchFailed(false);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setObjectUrl(null);
    setFetchFailed(false);

    (async () => {
      try {
        const token = await shopify.idToken();
        const res = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setFetchFailed(true);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (!cancelled) setFetchFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [dataUrl, fetchUrl, shopify]);

  const src = dataUrl || objectUrl || undefined;
  const loading = !src && !fetchFailed;

  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "3 / 4",
        borderRadius: "var(--p-border-radius-200, 8px)",
        overflow: "hidden",
        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
        border:
          "var(--p-border-width-0165, 1px) solid var(--p-color-border, #e3e3e3)",
        display: src ? "block" : "grid",
        placeItems: src ? undefined : "center",
        position: "relative",
      }}
      aria-busy={loading || undefined}
    >
      {src ? (
        <s-image
          src={src}
          alt={`${name} preview`}
          aspectRatio="3/4"
          objectFit={objectFit}
          inlineSize="fill"
          borderRadius="base"
          loading="lazy"
        />
      ) : loading ? (
        <s-spinner
          size="small"
          accessibilityLabel={`Loading ${name} preview`}
        />
      ) : (
        <s-text color="subdued">No preview</s-text>
      )}
    </div>
  );
}
