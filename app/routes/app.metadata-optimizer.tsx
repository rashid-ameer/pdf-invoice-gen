import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ActionFunctionArgs, LoaderFunctionArgs} from 'react-router';
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from 'react-router';
import {useAppBridge} from '@shopify/app-bridge-react';

import {
  FEATURE_CARDS,
  HANDLE_TYPES,
  HEADING_TAB_LABELS,
  HEADING_TAB_TYPES,
  HEADING_TYPES,
  IMAGE_TAB_LABELS,
  IMAGE_TAB_TYPES,
  IMAGE_TYPES,
  SCAN_STEPS,
  SEO_TAB_LABELS,
  SEO_TAB_TYPES,
  SEO_TYPES,
  URL_TAB_LABELS,
  URL_TAB_TYPES,
  adminEditUrl,
  normalizeItemType,
  type FeatureSectionId,
} from '../components/metadata-optimizer/constants';
import {
  FeatureCards,
  OptimizeModal,
  ScanProgress,
  StatCards,
  StatusBadge,
  TypeBadge,
  type PreviewSuggestion,
  type UiItem,
} from '../components/metadata-optimizer/OptimizerUi';
import {requireExtraFeatureFlag} from '../models/shop-extra-features.server';
import {
  applyOptimize,
  bulkOptimize,
} from '../models/seo-optimize.server';
import {
  listScanResults,
  previewOptimize,
  runScan,
  type SerializedSeoResult,
} from '../models/seo-scan.server';
import {authenticate} from '../shopify.server';

const ITEMS_PAGE_SIZE = 20;

function toUiItem(r: SerializedSeoResult): UiItem {
  return {
    ...r,
    type: normalizeItemType(r.resource_type),
  };
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'metadataOptimizerEnabled');
  const data = await listScanResults(session.shop);
  return {...data, shop: session.shop};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {admin, session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'metadataOptimizerEnabled');
  const formData = await request.formData();
  const intent = String(formData.get('intent') || '');

  try {
    if (intent === 'scan') {
      const data = await runScan(admin, session.shop);
      return {ok: true, intent, ...data};
    }

    if (intent === 'preview') {
      const id = String(formData.get('id') || '');
      const suggestion = await previewOptimize(session.shop, id);
      return {ok: true, intent, id, suggestion};
    }

    if (intent === 'optimize') {
      const id = String(formData.get('id') || '');
      const overrides: Record<string, string> = {};
      for (const key of [
        'meta_title',
        'meta_description',
        'alt_text',
        'handle',
        'h1',
        'h2',
      ] as const) {
        const value = String(formData.get(key) || '').trim();
        if (value) overrides[key] = value;
      }
      const item = await applyOptimize(
        admin,
        session.shop,
        id,
        Object.keys(overrides).length ? overrides : undefined,
      );
      return {ok: true, intent, item};
    }

    if (intent === 'bulk_optimize') {
      const ids = String(formData.get('ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await bulkOptimize(admin, session.shop, ids);
      const data = await listScanResults(session.shop);
      return {ok: true, intent, ...result, ...data};
    }

    return {ok: false, error: 'Unknown action'};
  } catch (error) {
    return {
      ok: false,
      intent,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
};

export default function MetadataOptimizerPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [items, setItems] = useState<UiItem[]>(() =>
    loaderData.items.map(toUiItem),
  );
  const [activeSection, setActiveSection] = useState<FeatureSectionId | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanStep, setScanStep] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [lastScanTime, setLastScanTime] = useState<string | null>(() => {
    const times = loaderData.items
      .map((i: SerializedSeoResult) => i.last_scanned_at)
      .filter(Boolean) as string[];
    if (!times.length) return null;
    const latest = times.sort()[times.length - 1]!;
    return new Date(latest).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  });

  const [modalItem, setModalItem] = useState<UiItem | null>(null);
  const [modalSuggestion, setModalSuggestion] =
    useState<PreviewSuggestion | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const optimizingIdRef = useRef<string | null>(null);

  const busy =
    navigation.state === 'submitting' && navigation.formMethod === 'POST';
  const intent =
    navigation.formData?.get('intent')?.toString() ||
    (actionData && 'intent' in actionData ? actionData.intent : '');
  const isScanning = busy && intent === 'scan';
  const hasScanned = items.length > 0;

  const seoItems = useMemo(
    () =>
      items.filter((i) => (SEO_TYPES as readonly string[]).includes(i.type)),
    [items],
  );
  const imageItems = useMemo(
    () =>
      items.filter((i) => (IMAGE_TYPES as readonly string[]).includes(i.type)),
    [items],
  );
  const handleItems = useMemo(
    () =>
      items.filter((i) => (HANDLE_TYPES as readonly string[]).includes(i.type)),
    [items],
  );
  const headingItems = useMemo(
    () =>
      items.filter((i) =>
        (HEADING_TYPES as readonly string[]).includes(i.type),
      ),
    [items],
  );

  const sectionItems =
    activeSection === 1
      ? imageItems
      : activeSection === 2
        ? handleItems
        : activeSection === 3
          ? headingItems
          : seoItems;

  const tabTypes =
    activeSection === 1
      ? IMAGE_TAB_TYPES
      : activeSection === 2
        ? URL_TAB_TYPES
        : activeSection === 3
          ? HEADING_TAB_TYPES
          : SEO_TAB_TYPES;
  const tabLabels =
    activeSection === 1
      ? IMAGE_TAB_LABELS
      : activeSection === 2
        ? URL_TAB_LABELS
        : activeSection === 3
          ? HEADING_TAB_LABELS
          : SEO_TAB_LABELS;

  const currentType = tabTypes[selectedTab] || 'all';

  const filteredItems = sectionItems.filter((item) => {
    const matchesTab = currentType === 'all' || item.type === currentType;
    const q = searchQuery.toLowerCase();
    const name = (item.resource_name || '').toLowerCase();
    const url = (item.resource_url || '').toLowerCase();
    const matchesSearch = !q || name.includes(q) || url.includes(q);
    return matchesTab && matchesSearch;
  });

  const totalPages = Math.max(
    1,
    Math.ceil(filteredItems.length / ITEMS_PAGE_SIZE),
  );
  const safePage = Math.min(currentPage, totalPages);
  const pagedItems = filteredItems.slice(
    (safePage - 1) * ITEMS_PAGE_SIZE,
    safePage * ITEMS_PAGE_SIZE,
  );
  const rangeStart =
    filteredItems.length === 0 ? 0 : (safePage - 1) * ITEMS_PAGE_SIZE + 1;
  const rangeEnd = (safePage - 1) * ITEMS_PAGE_SIZE + pagedItems.length;

  const stats = {
    totalScanned: sectionItems.length,
    issuesFound: sectionItems.filter((i) => i.issues.length > 0).length,
    optimized: sectionItems.filter((i) => i.status === 'optimized').length,
    pending: sectionItems.filter((i) => i.status === 'processing').length,
  };

  useEffect(() => {
    setItems(loaderData.items.map(toUiItem));
  }, [loaderData.items]);

  useEffect(() => {
    if (!isScanning) return;
    setScanStep(0);
    setScanProgress(0);
    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      setScanStep(Math.min(step, SCAN_STEPS.length - 2));
      setScanProgress(Math.round((step / (SCAN_STEPS.length - 1)) * 100));
      if (step >= SCAN_STEPS.length - 2) clearInterval(interval);
    }, 800);
    return () => clearInterval(interval);
  }, [isScanning]);

  useEffect(() => {
    if (!actionData) return;
    if (!actionData.ok) {
      if (actionData.intent === 'preview') {
        setModalLoading(false);
        setModalError(
          ('error' in actionData && actionData.error) ||
            'Failed to generate suggestion. Please try again.',
        );
      } else {
        shopify.toast.show(
          ('error' in actionData && actionData.error) || 'Action failed',
          {isError: true},
        );
      }
      if (actionData.intent === 'optimize' && optimizingIdRef.current) {
        const failedId = optimizingIdRef.current;
        optimizingIdRef.current = null;
        setItems((prev) =>
          prev.map((row) =>
            row.id === failedId ? {...row, status: 'needs_fix'} : row,
          ),
        );
      }
      return;
    }

    if (
      actionData.intent === 'scan' &&
      'items' in actionData &&
      actionData.items
    ) {
      setScanStep(SCAN_STEPS.length - 1);
      setScanProgress(100);
      setItems(actionData.items.map(toUiItem));
      setSelected(new Set());
      setCurrentPage(1);
      setLastScanTime(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
      shopify.toast.show(
        `Scan complete — ${actionData.items.length} items checked.`,
      );
    }

    if (
      actionData.intent === 'preview' &&
      'suggestion' in actionData &&
      actionData.suggestion &&
      actionData.id
    ) {
      setModalLoading(false);
      setModalError(null);
      setModalSuggestion({
        meta_title: String(actionData.suggestion.meta_title || ''),
        meta_description: String(actionData.suggestion.meta_description || ''),
        alt_text: String(actionData.suggestion.alt_text || ''),
        handle: String(actionData.suggestion.handle || ''),
        h1: String(actionData.suggestion.h1 || ''),
        h2: String(actionData.suggestion.h2 || ''),
      });
    }

    if (
      actionData.intent === 'optimize' &&
      'item' in actionData &&
      actionData.item
    ) {
      const updated = toUiItem(actionData.item);
      optimizingIdRef.current = null;
      setItems((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row)),
      );
      setModalItem(null);
      setModalSuggestion(null);
      setModalError(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(updated.id);
        return next;
      });
      shopify.toast.show(
        `${updated.resource_name || 'Item'} optimized successfully.`,
      );
    }

    if (
      actionData.intent === 'bulk_optimize' &&
      'items' in actionData &&
      actionData.items
    ) {
      setItems(actionData.items.map(toUiItem));
      setSelected(new Set());
      const n =
        'optimized' in actionData && Array.isArray(actionData.optimized)
          ? actionData.optimized.length
          : 0;
      const failed =
        'failed' in actionData && Array.isArray(actionData.failed)
          ? actionData.failed.length
          : 0;
      const errors =
        'errors' in actionData &&
        actionData.errors &&
        typeof actionData.errors === 'object'
          ? (actionData.errors as Record<string, string>)
          : {};
      const firstError = Object.values(errors)[0];

      if (n === 0 && failed > 0) {
        shopify.toast.show(
          firstError
            ? `Optimize failed: ${firstError}`
            : `Optimize failed for ${failed} item(s).`,
          {isError: true},
        );
      } else if (failed > 0) {
        shopify.toast.show(
          `Optimized ${n}; ${failed} failed${firstError ? ` (${firstError})` : ''}.`,
          {isError: true},
        );
      } else {
        shopify.toast.show(`Optimized ${n} item(s)`);
      }
    }
  }, [actionData, shopify]);

  const runIntent = useCallback(
    (nextIntent: string, extra?: Record<string, string>) => {
      const fd = new FormData();
      fd.set('intent', nextIntent);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) fd.set(k, v);
      }
      submit(fd, {method: 'post'});
    },
    [submit],
  );

  const handleSectionChange = (idx: FeatureSectionId | null) => {
    setActiveSection(idx);
    setSelectedTab(0);
    setSearchQuery('');
    setCurrentPage(1);
    setSelected(new Set());
  };

  const handleScan = () => {
    setSelected(new Set());
    runIntent('scan');
  };

  const handleAiOptimize = (item: UiItem) => {
    setModalItem(item);
    setModalSuggestion(null);
    setModalError(null);
    setModalLoading(true);
    runIntent('preview', {id: item.id});
  };

  const handleAcceptSuggestion = (overrides: Record<string, string>) => {
    if (!modalItem) return;
    const id = modalItem.id;
    optimizingIdRef.current = id;
    setItems((prev) =>
      prev.map((row) =>
        row.id === id ? {...row, status: 'processing'} : row,
      ),
    );
    runIntent('optimize', {id, ...overrides});
  };

  const handleManualEdit = (item: UiItem) => {
    const url = adminEditUrl(
      loaderData.shop,
      item.shopify_gid,
      item.resource_type,
      item.resource_url,
    );
    if (!url) {
      shopify.toast.show('Could not open admin editor for this item.', {
        isError: true,
      });
      return;
    }
    window.open(url, '_top');
  };

  const handleBulkOptimize = () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setSelected(new Set());
    setItems((prev) =>
      prev.map((row) =>
        ids.includes(row.id) ? {...row, status: 'processing'} : row,
      ),
    );
    runIntent('bulk_optimize', {ids: ids.join(',')});
  };

  const handleAutoOptimizeAll = () => {
    if (!hasScanned) {
      shopify.toast.show('Please run a scan first.', {isError: true});
      return;
    }
    const needsFix = sectionItems
      .filter((i) => i.status === 'needs_fix')
      .map((i) => i.id);
    if (!needsFix.length) {
      shopify.toast.show('All items are already optimized!');
      return;
    }
    setItems((prev) =>
      prev.map((row) =>
        needsFix.includes(row.id) ? {...row, status: 'processing'} : row,
      ),
    );
    runIntent('bulk_optimize', {ids: needsFix.join(',')});
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllPaged = () => {
    const selectable = pagedItems.filter((i) => i.status === 'needs_fix');
    const allSelected =
      selectable.length > 0 && selectable.every((i) => selected.has(i.id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const i of selectable) next.delete(i.id);
      } else {
        for (const i of selectable) next.add(i.id);
      }
      return next;
    });
  };

  const subtitle = lastScanTime
    ? `Last scan: ${lastScanTime}`
    : 'Scan, detect and fix SEO issues across your store';

  const pageHeading =
    activeSection === null
      ? 'Metadata Optimizer'
      : FEATURE_CARDS[activeSection]?.title || 'Metadata Optimizer';

  return (
    <s-page heading={pageHeading}>
      {activeSection !== null ? (
        <s-link
          slot="breadcrumb-actions"
          href="/app/metadata-optimizer"
          onClick={(e) => {
            e.preventDefault();
            handleSectionChange(null);
          }}
        >
          Features
        </s-link>
      ) : null}
      <s-button
        slot="primary-action"
        variant="primary"
        loading={isScanning}
        disabled={busy}
        onClick={handleScan}
        // @ts-expect-error -- suppressHydrationWarning isn't modeled by @shopify/polaris-types
        suppressHydrationWarning
      >
        Scan Store
      </s-button>
      {activeSection !== null ? (
        <s-button
          slot="secondary-actions"
          disabled={busy || isScanning}
          onClick={handleAutoOptimizeAll}
          // @ts-expect-error -- suppressHydrationWarning isn't modeled by @shopify/polaris-types
          suppressHydrationWarning
        >
          Auto-Optimize All
        </s-button>
      ) : null}

      <s-section>
        <s-paragraph color="subdued">{subtitle}</s-paragraph>
      </s-section>

      <ScanProgress
        isScanning={isScanning}
        scanStep={scanStep}
        scanProgress={scanProgress}
      />

      {activeSection === null ? (
        <s-section heading="Features">
          <FeatureCards
            hasScanned={hasScanned}
            cardItemCounts={[seoItems, imageItems, handleItems, headingItems]}
            onSelect={handleSectionChange}
          />
        </s-section>
      ) : (
        <s-stack gap="base">
          <s-section>
            <StatCards {...stats} />
          </s-section>

          <s-section heading="Items">
            <s-stack gap="base">
              <s-search-field
                label="Search items"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search items…"
                value={searchQuery}
                onInput={(e: Event) => {
                  setSearchQuery((e.currentTarget as HTMLInputElement).value);
                  setCurrentPage(1);
                }}
              />

              <s-stack direction="inline" gap="small-200">
                {tabTypes.map((type, i) => {
                  const count =
                    type === 'all'
                      ? sectionItems.length
                      : sectionItems.filter((it) => it.type === type).length;
                  const selectedTabActive = selectedTab === i;
                  return (
                    <s-button
                      key={type}
                      variant={selectedTabActive ? 'primary' : 'secondary'}
                      onClick={() => {
                        setSelectedTab(i);
                        setCurrentPage(1);
                      }}
                    >
                      {tabLabels[i]} ({count})
                    </s-button>
                  );
                })}
              </s-stack>

              {selected.size > 0 ? (
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-text>{selected.size} selected</s-text>
                  <s-button
                    variant="primary"
                    loading={busy && intent === 'bulk_optimize'}
                    disabled={busy}
                    onClick={handleBulkOptimize}
                  >
                    AI Optimize Selected
                  </s-button>
                </s-stack>
              ) : null}

              {!hasScanned ? (
                <s-box padding="large" background="subdued" borderRadius="base">
                  <s-stack gap="base">
                    <s-heading>No scan results yet</s-heading>
                    <s-paragraph>
                      Click Scan Store to check your metadata.
                    </s-paragraph>
                  </s-stack>
                </s-box>
              ) : filteredItems.length === 0 ? (
                <s-paragraph color="subdued">
                  No items match this filter.
                </s-paragraph>
              ) : (
                <s-stack gap="base">
                  <s-paragraph color="subdued">
                    Showing {rangeStart}–{rangeEnd} of {filteredItems.length}
                  </s-paragraph>
                  <s-table
                    paginate={totalPages > 1}
                    hasPreviousPage={safePage > 1}
                    hasNextPage={safePage < totalPages}
                    onPreviousPage={() =>
                      setCurrentPage((p) => Math.max(1, p - 1))
                    }
                    onNextPage={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    <s-table-header-row>
                      <s-table-header listSlot="primary">
                        <s-checkbox
                          checked={
                            pagedItems.filter((i) => i.status === 'needs_fix')
                              .length > 0 &&
                            pagedItems
                              .filter((i) => i.status === 'needs_fix')
                              .every((i) => selected.has(i.id))
                          }
                          onChange={toggleAllPaged}
                          accessibilityLabel="Select all needs-fix items on this page"
                        />
                      </s-table-header>
                      <s-table-header>Item</s-table-header>
                      <s-table-header>Type</s-table-header>
                      <s-table-header>Issues</s-table-header>
                      <s-table-header>Status</s-table-header>
                      <s-table-header listSlot="secondary">Action</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {pagedItems.map((item) => {
                        const url = item.resource_url || '';
                        const shortUrl =
                          url.length > 60 ? `${url.slice(0, 60)}…` : url;
                        const previewingThis =
                          busy &&
                          intent === 'preview' &&
                          navigation.formData?.get('id') === item.id;

                        return (
                          <s-table-row key={item.id}>
                            <s-table-cell>
                              <s-checkbox
                                checked={selected.has(item.id)}
                                disabled={item.status !== 'needs_fix'}
                                onChange={() => toggle(item.id)}
                                accessibilityLabel={`Select ${item.resource_name || item.id}`}
                              />
                            </s-table-cell>
                            <s-table-cell>
                              <s-stack gap="small-200">
                                <s-text type="strong">
                                  {item.resource_name || 'Untitled'}
                                </s-text>
                                {shortUrl ? (
                                  <s-text color="subdued">{shortUrl}</s-text>
                                ) : null}
                                {activeSection === 3 &&
                                item.resource_body_summary ? (
                                  <s-text color="subdued">
                                    {item.resource_body_summary}
                                  </s-text>
                                ) : null}
                              </s-stack>
                            </s-table-cell>
                            <s-table-cell>
                              <TypeBadge type={item.type} />
                            </s-table-cell>
                            <s-table-cell>
                              {item.issues.length === 0 ? (
                                <s-text color="subdued">—</s-text>
                              ) : (
                                <s-stack gap="small-200">
                                  {item.issues.map((issue) => (
                                    <s-text key={issue} tone="critical">
                                      ✕ {issue}
                                    </s-text>
                                  ))}
                                </s-stack>
                              )}
                            </s-table-cell>
                            <s-table-cell>
                              <StatusBadge status={item.status} />
                            </s-table-cell>
                            <s-table-cell>
                              {item.status === 'processing' ? (
                                <s-spinner accessibilityLabel="Optimizing" />
                              ) : item.status === 'optimized' ? (
                                <s-button disabled>Done</s-button>
                              ) : (
                                <>
                                  <s-button
                                    commandFor={`seo-actions-${item.id}`}
                                    icon="menu-vertical"
                                    variant="tertiary"
                                    loading={previewingThis}
                                    disabled={busy}
                                    accessibilityLabel={`Optimize ${item.resource_name || item.id}`}
                                  />
                                  <s-menu
                                    id={`seo-actions-${item.id}`}
                                    accessibilityLabel={`Optimize ${item.resource_name || item.id}`}
                                  >
                                    <s-button
                                      variant="tertiary"
                                      icon="wand"
                                      onClick={() => handleAiOptimize(item)}
                                    >
                                      AI Optimize
                                    </s-button>
                                    <s-button
                                      variant="tertiary"
                                      icon="edit"
                                      onClick={() => handleManualEdit(item)}
                                    >
                                      Edit Manually
                                    </s-button>
                                  </s-menu>
                                </>
                              )}
                            </s-table-cell>
                          </s-table-row>
                        );
                      })}
                    </s-table-body>
                  </s-table>
                </s-stack>
              )}
            </s-stack>
          </s-section>
        </s-stack>
      )}

      <OptimizeModal
        open={Boolean(modalItem)}
        item={modalItem}
        suggestion={modalSuggestion}
        loading={modalLoading}
        error={modalError}
        busyApply={busy && intent === 'optimize'}
        onAccept={handleAcceptSuggestion}
        onClose={() => {
          setModalItem(null);
          setModalSuggestion(null);
          setModalError(null);
          setModalLoading(false);
        }}
      />
    </s-page>
  );
}
