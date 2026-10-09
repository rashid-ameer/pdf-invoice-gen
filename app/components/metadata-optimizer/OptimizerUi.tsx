import {useEffect, useRef, useState} from 'react';
import {COLS_4, ResponsiveGrid} from '../layout/responsive-columns';

import type {SerializedSeoResult} from '../../models/seo-scan.server';
import {
  FEATURE_CARDS,
  HANDLE_TYPES,
  HEADING_TYPES,
  IMAGE_TYPES,
  SCAN_STEPS,
  TYPE_BADGE_MAP,
  type FeatureSectionId,
} from './constants';

const OPTIMIZE_MODAL_ID = 'metadata-optimize-modal';

type ModalElement = HTMLElement & {
  showOverlay: () => void;
  hideOverlay: () => void;
};

export type UiItem = SerializedSeoResult & {
  /** Normalized type for filtering (blog_article → blog). */
  type: string;
};

export type PreviewSuggestion = {
  meta_title: string;
  meta_description: string;
  alt_text: string;
  handle: string;
  h1: string;
  h2: string;
};

function emptySuggestion(): PreviewSuggestion {
  return {
    meta_title: '',
    meta_description: '',
    alt_text: '',
    handle: '',
    h1: '',
    h2: '',
  };
}

export function StatusBadge({status}: {status: string}) {
  if (status === 'optimized') {
    return <s-badge tone="success">Optimized</s-badge>;
  }
  if (status === 'processing') {
    return <s-badge tone="info">Processing</s-badge>;
  }
  return <s-badge tone="critical">Needs Fix</s-badge>;
}

export function TypeBadge({type}: {type: string}) {
  const mapped = TYPE_BADGE_MAP[type] || {
    tone: 'neutral' as const,
    label: type,
  };
  return <s-badge tone={mapped.tone}>{mapped.label}</s-badge>;
}

export function ScanProgress({
  isScanning,
  scanStep,
  scanProgress,
}: {
  isScanning: boolean;
  scanStep: number;
  scanProgress: number;
}) {
  if (!isScanning) return null;
  const label = SCAN_STEPS[Math.min(scanStep, SCAN_STEPS.length - 1)];
  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-spinner accessibilityLabel="Scanning store" />
          <s-text>
            {label} ({scanProgress}%)
          </s-text>
        </s-stack>
        <s-stack direction="inline" gap="small-200">
          {SCAN_STEPS.map((step, i) => (
            <s-badge key={step} tone={i <= scanStep ? 'info' : 'neutral'}>
              {i + 1}
            </s-badge>
          ))}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export function StatCards({
  totalScanned,
  issuesFound,
  optimized,
  pending,
}: {
  totalScanned: number;
  issuesFound: number;
  optimized: number;
  pending: number;
}) {
  const cards = [
    {label: 'Total Scanned', value: totalScanned, tone: 'info' as const},
    {label: 'Issues Found', value: issuesFound, tone: 'critical' as const},
    {label: 'Optimized', value: optimized, tone: 'success' as const},
    {label: 'Pending', value: pending, tone: 'neutral' as const},
  ];
  return (
    <ResponsiveGrid gridTemplateColumns={COLS_4} gap="base">
      {cards.map((card) => (
        <s-box
          key={card.label}
          padding="base"
          background="subdued"
          borderRadius="base"
          border="base"
        >
          <s-stack gap="small-200">
            <s-text color="subdued">{card.label}</s-text>
            <s-heading>
              <s-text type="strong" tone={card.tone}>
                {card.value}
              </s-text>
            </s-heading>
          </s-stack>
        </s-box>
      ))}
    </ResponsiveGrid>
  );
}

export function FeatureCards({
  hasScanned,
  cardItemCounts,
  onSelect,
}: {
  hasScanned: boolean;
  cardItemCounts: UiItem[][];
  onSelect: (id: FeatureSectionId) => void;
}) {
  return (
    <s-grid
      gridTemplateColumns="repeat(auto-fill, minmax(260px, 1fr))"
      gap="base"
    >
      {FEATURE_CARDS.map((card) => {
        const cardItems = cardItemCounts[card.id] || [];
        const issueCount = cardItems.filter(
          (i) => i.status === 'needs_fix',
        ).length;
        const optimizedCount = cardItems.filter(
          (i) => i.status === 'optimized',
        ).length;
        const total = cardItems.length;

        return (
          <s-clickable
            key={card.id}
            padding="base"
            background="subdued"
            border="base"
            borderRadius="base"
            onClick={() => onSelect(card.id)}
            accessibilityLabel={`View ${card.title}`}
          >
            <s-stack gap="base">
              <s-box padding="small" background="base" borderRadius="base">
                <s-icon type={card.icon as 'search'} />
              </s-box>
              <s-heading>{card.title}</s-heading>
              <s-paragraph color="subdued">{card.description}</s-paragraph>
              {hasScanned ? (
                <s-stack direction="inline" gap="small-200">
                  <s-text type="strong" tone="critical">
                    {issueCount} issue{issueCount === 1 ? '' : 's'}
                  </s-text>
                  <s-text color="subdued">·</s-text>
                  <s-text type="strong" tone="success">
                    {optimizedCount} optimized
                  </s-text>
                  <s-text color="subdued">·</s-text>
                  <s-text color="subdued">{total} total</s-text>
                </s-stack>
              ) : null}
              <s-text tone="info">View details →</s-text>
            </s-stack>
          </s-clickable>
        );
      })}
    </s-grid>
  );
}

export function OptimizeModal({
  open,
  item,
  suggestion,
  loading,
  error,
  busyApply,
  onAccept,
  onClose,
}: {
  open: boolean;
  item: UiItem | null;
  suggestion: PreviewSuggestion | null;
  loading: boolean;
  error: string | null;
  busyApply: boolean;
  onAccept: (overrides: Record<string, string>) => void;
  onClose: () => void;
}) {
  const wasOpen = useRef(false);
  const [fields, setFields] = useState<PreviewSuggestion>(emptySuggestion());

  useEffect(() => {
    if (!suggestion) return;
    setFields({...suggestion});
  }, [suggestion]);

  useEffect(() => {
    const modal = document.getElementById(
      OPTIMIZE_MODAL_ID,
    ) as ModalElement | null;
    if (!modal) return;
    if (open) {
      modal.showOverlay();
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current) {
      modal.hideOverlay();
      wasOpen.current = false;
    }
  }, [open]);

  const type = item?.type || '';
  const isImage = (IMAGE_TYPES as readonly string[]).includes(type);
  const isHandle = (HANDLE_TYPES as readonly string[]).includes(type);
  const isHeading = (HEADING_TYPES as readonly string[]).includes(type);
  const hasMissingH2 =
    isHeading && (item?.issues || []).some((i) => i.includes('Missing H2'));

  const canAccept = (() => {
    if (!suggestion || loading) return false;
    if (isImage) return fields.alt_text.trim().length > 0;
    if (isHandle) return fields.handle.trim().length > 0;
    if (isHeading) return fields.h1.trim().length > 0;
    return (
      fields.meta_title.trim().length > 0 &&
      fields.meta_description.trim().length > 0
    );
  })();

  const handleAccept = () => {
    if (isImage) return onAccept({alt_text: fields.alt_text});
    if (isHandle) return onAccept({handle: fields.handle});
    if (isHeading) {
      const overrides: Record<string, string> = {h1: fields.h1};
      if (fields.h2.trim()) overrides.h2 = fields.h2;
      return onAccept(overrides);
    }
    return onAccept({
      meta_title: fields.meta_title,
      meta_description: fields.meta_description,
    });
  };

  const patch = (key: keyof PreviewSuggestion, value: string) =>
    setFields((f) => ({...f, [key]: value}));

  return (
    <s-modal
      id={OPTIMIZE_MODAL_ID}
      heading={
        item
          ? `AI Suggestion — ${item.resource_name || 'Item'}`
          : 'AI Suggestion'
      }
      onHide={onClose}
    >
      <s-stack gap="base">
        {item ? (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text color="subdued">
              {item.resource_url || item.resource_name || ''}
            </s-text>
            {item.status === 'needs_fix' ? (
              <s-badge tone="critical">Needs Fix</s-badge>
            ) : null}
          </s-stack>
        ) : null}

        {loading ? (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner accessibilityLabel="Generating suggestion" />
            <s-text color="subdued">Generating AI suggestion…</s-text>
          </s-stack>
        ) : null}

        {error ? <s-banner tone="critical">{error}</s-banner> : null}

        {suggestion && !loading ? (
          <>
            {isImage ? (
              <s-stack gap="base">
                <s-box padding="small" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    <s-text color="subdued">Alt Text — current</s-text>
                    <s-text>{item?.current_image_alt || 'None'}</s-text>
                  </s-stack>
                </s-box>
                <s-text-field
                  label="Alt Text — AI suggestion (editable)"
                  value={fields.alt_text}
                  maxLength={125}
                  details="Max 125 characters. Be descriptive — include the primary keyword."
                  onInput={(e: Event) =>
                    patch(
                      'alt_text',
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </s-stack>
            ) : null}

            {isHandle ? (
              <s-stack gap="base">
                <s-box padding="small" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    <s-text color="subdued">URL Handle — current</s-text>
                    <s-text>{item?.current_handle || 'None'}</s-text>
                  </s-stack>
                </s-box>
                <s-text-field
                  label="URL Handle — AI suggestion (editable)"
                  value={fields.handle}
                  maxLength={60}
                  details="Lowercase letters, numbers, and hyphens only. Max 60 characters."
                  onInput={(e: Event) =>
                    patch(
                      'handle',
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </s-stack>
            ) : null}

            {isHeading ? (
              <s-stack gap="base">
                <s-box padding="small" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    <s-text color="subdued">H1 Heading — current</s-text>
                    <s-text>{item?.current_seo_title || 'None'}</s-text>
                  </s-stack>
                </s-box>
                <s-text-field
                  label="H1 Heading — AI suggestion (editable)"
                  value={fields.h1}
                  details="Replaces all existing H1 tags and is placed at the top of the description."
                  onInput={(e: Event) =>
                    patch('h1', (e.currentTarget as HTMLInputElement).value)
                  }
                />
                {hasMissingH2 ? (
                  <s-text-field
                    label="H2 Subheading — AI suggestion (editable)"
                    value={fields.h2}
                    details="Inserted after the H1. Leave blank to skip adding an H2."
                    onInput={(e: Event) =>
                      patch('h2', (e.currentTarget as HTMLInputElement).value)
                    }
                  />
                ) : null}
              </s-stack>
            ) : null}

            {!isImage && !isHandle && !isHeading ? (
              <s-stack gap="base">
                <s-box padding="small" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    <s-text color="subdued">Meta Title — current</s-text>
                    <s-text>{item?.current_seo_title || 'None'}</s-text>
                  </s-stack>
                </s-box>
                <s-text-field
                  label="Meta Title — AI suggestion (editable)"
                  value={fields.meta_title}
                  maxLength={60}
                  details="30–60 characters recommended."
                  onInput={(e: Event) =>
                    patch(
                      'meta_title',
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
                <s-box padding="small" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    <s-text color="subdued">Meta Description — current</s-text>
                    <s-text>{item?.current_seo_description || 'None'}</s-text>
                  </s-stack>
                </s-box>
                <s-text-area
                  label="Meta Description — AI suggestion (editable)"
                  value={fields.meta_description}
                  rows={3}
                  maxLength={160}
                  details="120–160 characters recommended."
                  onInput={(e: Event) =>
                    patch(
                      'meta_description',
                      (e.currentTarget as HTMLTextAreaElement).value,
                    )
                  }
                />
              </s-stack>
            ) : null}
          </>
        ) : null}
      </s-stack>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!canAccept || busyApply}
        loading={busyApply}
        onClick={handleAccept}
      >
        Accept & Apply
      </s-button>
      <s-button
        slot="secondary-actions"
        commandFor={OPTIMIZE_MODAL_ID}
        command="--hide"
        onClick={onClose}
      >
        Cancel
      </s-button>
    </s-modal>
  );
}
