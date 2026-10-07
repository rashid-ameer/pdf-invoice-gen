/**
 * Shared Templates gallery card + preview.
 * Layout, badges, buttons, selected style, and delete rules must stay identical
 * to the previous inline implementation on the Templates list page.
 */
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

import type { TemplateListItem } from "../models/template.server";

export const DELETE_MODAL_ID = "delete-template-modal";
export const DELETE_DISABLED_TOOLTIP_ID = "delete-selected-template-tooltip";

/** 1 col mobile → 2 tablet → 4 desktop (container-query range syntax). */
export const CARD_GRID_COLUMNS =
  "@container (inline-size < 560px) 1fr, (560px <= inline-size < 768px) 1fr 1fr, 1fr 1fr 1fr 1fr";

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

  return (
    <s-section
      padding="base"
      accessibilityLabel={`${item.name}${isSelected ? ", selected" : ""}`}
    >
      <s-stack gap="base">
        <TemplatePreview
          dataUrl={item.thumbnailDataUrl}
          fetchUrl={item.thumbnailUrl}
          name={item.name}
        />

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
  );
}

/**
 * List thumbnail: prefer cached data URL from the loader (no auth needed).
 * Fall back to s-image placeholder, then fetch JPEG with App Bridge Bearer
 * when cache is still empty.
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
  /** Gallery cards keep `cover`; overview type cards use `contain`. */
  objectFit?: "cover" | "contain";
}) {
  const shopify = useAppBridge();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (dataUrl) {
      setObjectUrl(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;

    (async () => {
      try {
        const token = await shopify.idToken();
        const res = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        // Keep s-image placeholder — never force a blank failed state.
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [dataUrl, fetchUrl, shopify]);

  const src = dataUrl || objectUrl || undefined;

  return (
    <s-image
      {...(src ? { src } : {})}
      alt={`${name} preview`}
      aspectRatio="3/4"
      objectFit={objectFit}
      inlineSize="fill"
      border="base"
      borderRadius="base"
      loading="lazy"
    />
  );
}
