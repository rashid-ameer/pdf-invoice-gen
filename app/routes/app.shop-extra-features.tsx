import {useEffect, useMemo, useState} from 'react';
import type {ActionFunctionArgs, LoaderFunctionArgs} from 'react-router';
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from 'react-router';
import {useAppBridge} from '@shopify/app-bridge-react';
import {ConfirmModal} from '../components/ConfirmModal';
import {
  COLS_MAIN_AUTO,
  ResponsiveGrid,
} from '../components/layout/responsive-columns';
import {
  checkedValue,
  fieldValue,
  selectValue,
} from '../utils/polaris-events';
import {
  createShopExtraFeature,
  deleteShopExtraFeature,
  isExtraFeaturesAdmin,
  listShopExtraFeatures,
  parseExtraFeatureFlagsForm,
  updateShopExtraFeature,
} from '../models/shop-extra-features.server';
import {authenticate} from '../shopify.server';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const FORM_MODAL_ID = 'shop-extra-features-form-modal';
const DELETE_MODAL_ID = 'shop-extra-features-delete-modal';

type ExtraFeatureFlags = {
  trustedBadgesEnabled: boolean;
  wishlistEnabled: boolean;
  speedOptimizerEnabled: boolean;
  metadataOptimizerEnabled: boolean;
  upsellEnabled: boolean;
};

type ShopExtraFeatureRecord = ExtraFeatureFlags & {
  id: string;
  shop: string;
};

const FEATURE_FIELDS: {
  name: keyof ExtraFeatureFlags;
  label: string;
}[] = [
  {name: 'trustedBadgesEnabled', label: 'Trusted badges'},
  {name: 'wishlistEnabled', label: 'Wishlist'},
  {name: 'speedOptimizerEnabled', label: 'Speed optimizer'},
  {name: 'metadataOptimizerEnabled', label: 'Metadata optimizer'},
  {name: 'upsellEnabled', label: 'Upsell'},
];

type FormState = ExtraFeatureFlags & {shopifyDomain: string};

/** Rails emptyForm parity — client-safe (must not import from *.server). */
function emptyForm(): FormState {
  return {
    shopifyDomain: '',
    trustedBadgesEnabled: true,
    wishlistEnabled: true,
    speedOptimizerEnabled: true,
    metadataOptimizerEnabled: true,
    upsellEnabled: true,
  };
}

function formFromRecord(row: ShopExtraFeatureRecord): FormState {
  return {
    shopifyDomain: row.shop,
    trustedBadgesEnabled: row.trustedBadgesEnabled,
    wishlistEnabled: row.wishlistEnabled,
    speedOptimizerEnabled: row.speedOptimizerEnabled,
    metadataOptimizerEnabled: row.metadataOptimizerEnabled,
    upsellEnabled: row.upsellEnabled,
  };
}

function flagLabel(on: boolean) {
  return on ? 'On' : 'Off';
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  if (!isExtraFeaturesAdmin(session.shop)) {
    throw redirect('/app');
  }
  return {records: await listShopExtraFeatures()};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  if (!isExtraFeaturesAdmin(session.shop)) {
    throw redirect('/app');
  }

  const formData = await request.formData();
  const intent = String(formData.get('_action') || '');

  try {
    if (intent === 'create') {
      const domain = String(formData.get('shopifyDomain') || '');
      await createShopExtraFeature(domain, parseExtraFeatureFlagsForm(formData));
      return {ok: true as const, intent, message: 'Store features created'};
    }

    if (intent === 'update') {
      const id = String(formData.get('id') || '');
      const domain = String(formData.get('shopifyDomain') || '');
      await updateShopExtraFeature(
        id,
        domain,
        parseExtraFeatureFlagsForm(formData),
      );
      return {ok: true as const, intent, message: 'Store features saved'};
    }

    if (intent === 'delete') {
      const id = String(formData.get('id') || '');
      await deleteShopExtraFeature(id);
      return {ok: true as const, intent, message: 'Store features deleted'};
    }

    return {ok: false as const, error: 'Unknown action'};
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'Save failed',
    };
  }
};

export default function ShopExtraFeaturesPage() {
  const {records} = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [domainSearch, setDomainSearch] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<ShopExtraFeatureRecord | null>(null);

  const saving =
    navigation.state === 'submitting' && navigation.formMethod === 'POST';
  const deleting =
    saving && String(navigation.formData?.get('_action') || '') === 'delete';

  const filteredRecords = useMemo(() => {
    const q = domainSearch.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => r.shop.toLowerCase().includes(q));
  }, [records, domainSearch]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRecords.length / pageSize) || 1,
  );

  useEffect(() => {
    setCurrentPage((p) => (p > totalPages ? totalPages : p));
  }, [totalPages]);

  const pagedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  const rangeStart =
    filteredRecords.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = (currentPage - 1) * pageSize + pagedRecords.length;

  useEffect(() => {
    const modal = document.getElementById(FORM_MODAL_ID) as
      | (HTMLElement & {showOverlay: () => void; hideOverlay: () => void})
      | null;
    if (!modal) return;
    if (modalOpen) modal.showOverlay();
    else modal.hideOverlay();
  }, [modalOpen]);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      shopify.toast.show(actionData.message);
      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm());
      setFormError(null);
      setPendingDelete(null);
      return;
    }
    if ('error' in actionData && actionData.error) {
      setFormError(actionData.error);
      if (!modalOpen) {
        shopify.toast.show(actionData.error, {isError: true});
      }
    }
  }, [actionData, shopify, modalOpen]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (row: ShopExtraFeatureRecord) => {
    setEditingId(row.id);
    setForm(formFromRecord(row));
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const onDomainSearch = (value: string) => {
    setDomainSearch(value);
    setCurrentPage(1);
  };

  const onPageSize = (value: string) => {
    setPageSize(parseInt(value, 10) || 20);
    setCurrentPage(1);
  };

  const submitForm = () => {
    const domain = form.shopifyDomain.trim();
    if (!domain) {
      setFormError('Shopify domain is required');
      return;
    }
    setFormError(null);
    const fd = new FormData();
    fd.set('_action', editingId ? 'update' : 'create');
    if (editingId) fd.set('id', editingId);
    fd.set('shopifyDomain', domain);
    for (const f of FEATURE_FIELDS) {
      fd.set(f.name as string, form[f.name] ? 'true' : 'false');
    }
    submit(fd, {method: 'post'});
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const fd = new FormData();
    fd.set('_action', 'delete');
    fd.set('id', pendingDelete.id);
    submit(fd, {method: 'post'});
  };

  return (
    <s-page heading="Store extra features">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={openCreate}
        // @ts-expect-error -- suppressHydrationWarning isn't modeled by @shopify/polaris-types
        suppressHydrationWarning
      >
        Add store
      </s-button>

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Manage which Shopify stores have optional product features enabled.
          </s-paragraph>

          <ResponsiveGrid
            gridTemplateColumns={COLS_MAIN_AUTO}
            gap="base"
            alignItems="end"
          >
            <s-text-field
              label="Search by store domain"
              icon="search"
              value={domainSearch}
              autocomplete="off"
              onInput={(e: Event) => onDomainSearch(fieldValue(e))}
            />
            <s-box minInlineSize="160px">
              <s-select
                label="Rows per page"
                value={String(pageSize)}
                onChange={(e: Event) => onPageSize(selectValue(e))}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <s-option key={n} value={String(n)}>
                    {String(n)}
                  </s-option>
                ))}
              </s-select>
            </s-box>
          </ResponsiveGrid>

          {filteredRecords.length === 0 && records.length > 0 ? (
            <s-paragraph color="subdued">
              No stores match that domain search.
            </s-paragraph>
          ) : null}

          <s-section padding="none">
            <s-table
              paginate={totalPages > 1}
              hasPreviousPage={currentPage > 1}
              hasNextPage={currentPage < totalPages}
              onPreviousPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNextPage={() =>
                setCurrentPage((p) => Math.min(totalPages, p + 1))
              }
            >
              <s-table-header-row>
                <s-table-header listSlot="primary">Store domain</s-table-header>
                <s-table-header listSlot="labeled">
                  Trusted badges
                </s-table-header>
                <s-table-header listSlot="labeled">Wishlist</s-table-header>
                <s-table-header listSlot="labeled">
                  Speed optimizer
                </s-table-header>
                <s-table-header listSlot="labeled">
                  Metadata optimizer
                </s-table-header>
                <s-table-header listSlot="labeled">Upsell</s-table-header>
                <s-table-header listSlot="labeled">Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {pagedRecords.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>{row.shop}</s-table-cell>
                    <s-table-cell>
                      {flagLabel(row.trustedBadgesEnabled)}
                    </s-table-cell>
                    <s-table-cell>
                      {flagLabel(row.wishlistEnabled)}
                    </s-table-cell>
                    <s-table-cell>
                      {flagLabel(row.speedOptimizerEnabled)}
                    </s-table-cell>
                    <s-table-cell>
                      {flagLabel(row.metadataOptimizerEnabled)}
                    </s-table-cell>
                    <s-table-cell>{flagLabel(row.upsellEnabled)}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          variant="secondary"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </s-button>
                        <s-button
                          variant="secondary"
                          tone="critical"
                          onClick={() => setPendingDelete(row)}
                        >
                          Delete
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          {filteredRecords.length > 0 ? (
            <s-paragraph color="subdued">
              {`Showing ${rangeStart}–${rangeEnd} of ${filteredRecords.length}`}
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      <s-modal
        id={FORM_MODAL_ID}
        heading={editingId ? 'Edit store features' : 'Add store features'}
        onHide={closeModal}
      >
        <s-stack gap="base">
          {formError ? (
            <s-banner tone="critical" dismissible onDismiss={() => setFormError(null)}>
              {formError}
            </s-banner>
          ) : null}
          <s-text-field
            label="Shopify domain"
            value={form.shopifyDomain}
            placeholder="e.g. my-store.myshopify.com"
            details="e.g. my-store.myshopify.com"
            autocomplete="off"
            onInput={(e: Event) => {
              const shopifyDomain = fieldValue(e);
              setForm((prev) => ({...prev, shopifyDomain}));
            }}
          />
          {FEATURE_FIELDS.map((f) => (
            <s-checkbox
              key={f.name}
              label={f.label}
              checked={form[f.name]}
              onChange={(e: Event) => {
                const checked = checkedValue(e);
                setForm((prev) => ({...prev, [f.name]: checked}));
              }}
            />
          ))}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={saving && !deleting}
          disabled={saving}
          onClick={submitForm}
        >
          {editingId ? 'Save' : 'Create'}
        </s-button>
        <s-button
          slot="secondary-actions"
          type="button"
          commandFor={FORM_MODAL_ID}
          command="--hide"
          disabled={saving}
          onClick={closeModal}
        >
          Cancel
        </s-button>
      </s-modal>

      <ConfirmModal
        id={DELETE_MODAL_ID}
        open={pendingDelete !== null}
        heading="Delete store features"
        message={
          pendingDelete
            ? `Delete extra features for ${pendingDelete.shop}?`
            : ''
        }
        confirmLabel="Delete"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </s-page>
  );
}
