import {useEffect, useRef, useState} from 'react';
import type {ActionFunctionArgs, LoaderFunctionArgs} from 'react-router';
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
} from 'react-router';
import {useAppBridge} from '@shopify/app-bridge-react';
import {ConfirmModal} from '../components/ConfirmModal';
import {
  COLS_2,
  COLS_ICON_PICKER,
  ResponsiveGrid,
} from '../components/layout/responsive-columns';
import {
  checkedValue,
  fieldValue,
  numberValue,
  selectValue,
  type DropZoneElement,
} from '../utils/polaris-events';
import {
  bulkReorder,
  createBadge,
  deleteBadge,
  listBadges,
  updateBadge,
  uploadBadgeIcon,
} from '../models/trusted-badges.server';
import {requireExtraFeatureFlag} from '../models/shop-extra-features.server';
import {authenticate} from '../shopify.server';

const FORM_MODAL_ID = 'trusted-badge-form-modal';
const DELETE_MODAL_ID = 'trusted-badge-delete-modal';

type TrustedBadgeSnake = {
  id: string;
  icon_type: string;
  icon_value: string;
  label_text: string;
  badge_color: string;
  text_color: string;
  font_size: number;
  border_radius: number;
  position: number;
  published: boolean;
};

const PRESET_ICON_PATHS: Record<string, string> = {
  shield:
    'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  checkmark: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  truck:
    'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  heart:
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  verified:
    'M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.69 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z',
  secure:
    'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
  payment:
    'M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z',
  fast: 'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z',
  return:
    'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  quality:
    'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z',
  support:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  certificate: 'M4 3h16v12H4zm8 14l-4 4v-4H4v-2h16v2h-4v4z',
  award:
    'M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V17H7v2h10v-2h-4v-1.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z',
  badge:
    'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
};

const PRESET_KEYS = Object.keys(PRESET_ICON_PATHS);

const EMPTY_FORM = {
  icon_type: 'preset',
  icon_value: 'shield',
  label_text: '',
  badge_color: '#000000',
  text_color: '#ffffff',
  font_size: '14',
  border_radius: '4',
  published: true,
};

type BadgeForm = typeof EMPTY_FORM;

type ModalElement = HTMLElement & {
  showOverlay: () => void;
  hideOverlay: () => void;
};

function PresetIcon({
  name,
  size = 24,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const path = PRESET_ICON_PATHS[name] || PRESET_ICON_PATHS.shield;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={size}
      height={size}
      style={color ? {color} : undefined}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function BadgeIcon({
  iconType,
  iconValue,
  color,
  size = 24,
}: {
  iconType: string;
  iconValue: string;
  color?: string;
  size?: number;
}) {
  if (iconType !== 'preset' && iconValue) {
    return (
      <img
        src={iconValue}
        alt=""
        style={{width: size, height: size, objectFit: 'contain'}}
      />
    );
  }
  return <PresetIcon name={iconValue || 'shield'} size={size} color={color} />;
}

function BadgeChipPreview({
  badgeColor,
  textColor,
  iconType,
  iconValue,
  label,
  fontSize,
  borderRadius,
}: {
  badgeColor: string;
  textColor: string;
  iconType: string;
  iconValue: string;
  label: string;
  fontSize: number;
  borderRadius: number;
}) {
  const size = fontSize;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        backgroundColor: badgeColor,
        borderRadius,
        border: '1px solid #e1e3e5',
      }}
    >
      <span style={{color: textColor, display: 'inline-flex'}}>
        <BadgeIcon
          iconType={iconType}
          iconValue={iconValue}
          color={textColor}
          size={size}
        />
      </span>
      <span
        style={{
          color: textColor,
          fontSize,
          fontWeight: 500,
          lineHeight: 1,
        }}
      >
        {label || 'Badge Text'}
      </span>
    </div>
  );
}

function ListIconChip({
  badgeColor,
  textColor,
  iconType,
  iconValue,
}: {
  badgeColor: string;
  textColor: string;
  iconType: string;
  iconValue: string;
}) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        backgroundColor: badgeColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid #e1e3e5',
        flexShrink: 0,
      }}
    >
      <BadgeIcon
        iconType={iconType}
        iconValue={iconValue}
        color={textColor}
        size={24}
      />
    </div>
  );
}

function titleCase(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'trustedBadgesEnabled');
  const badges = await listBadges(session.shop);
  return {badges};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {admin, session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'trustedBadgesEnabled');
  const formData = await request.formData();
  const intent = String(formData.get('intent') || '');

  try {
    if (intent === 'create' || intent === 'update') {
      const iconType = String(formData.get('icon_type') || 'preset');
      let iconValue = String(formData.get('icon_value') || 'shield');
      const file = formData.get('icon');
      if (
        iconType === 'upload' &&
        file instanceof File &&
        file.size > 0
      ) {
        const uploaded = await uploadBadgeIcon(admin, file);
        iconValue = uploaded.icon_url;
      }

      const payload = {
        icon_type: iconType,
        icon_value: iconValue,
        label_text: String(formData.get('label_text') || ''),
        badge_color: String(formData.get('badge_color') || '#000000'),
        text_color: String(formData.get('text_color') || '#ffffff'),
        font_size: Number.parseInt(String(formData.get('font_size') || '14'), 10),
        border_radius: Number.parseInt(
          String(formData.get('border_radius') || '4'),
          10,
        ),
        published: formData.get('published') === 'true',
      };
      if (intent === 'create') {
        const badge = await createBadge(session.shop, payload);
        return {ok: true, intent, badge};
      }
      const id = String(formData.get('id') || '');
      const badge = await updateBadge(session.shop, id, payload);
      return {ok: true, intent, badge};
    }
    if (intent === 'delete') {
      await deleteBadge(session.shop, String(formData.get('id') || ''));
      return {ok: true, intent};
    }
    if (intent === 'toggle') {
      const id = String(formData.get('id') || '');
      const published = formData.get('published') === 'true';
      await updateBadge(session.shop, id, {published});
      return {ok: true, intent};
    }
    if (intent === 'reorder') {
      const orderedIds = JSON.parse(String(formData.get('ordered_ids') || '[]'));
      await bulkReorder(session.shop, orderedIds);
      return {ok: true, intent};
    }
    return {ok: false, intent, error: 'Unknown intent'};
  } catch (e) {
    return {
      ok: false,
      intent,
      error: e instanceof Error ? e.message : 'Something went wrong',
    };
  }
};

export default function TrustedBadgesPage() {
  const {badges: initial} = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [badges, setBadges] = useState<TrustedBadgeSnake[]>(initial);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrustedBadgeSnake | null>(null);
  const [form, setForm] = useState<BadgeForm>({...EMPTY_FORM});
  const [selectedIconFile, setSelectedIconFile] = useState<File | null>(null);
  const [labelError, setLabelError] = useState('');
  const [iconError, setIconError] = useState('');
  const [formError, setFormError] = useState('');
  const [deletingBadge, setDeletingBadge] = useState<TrustedBadgeSnake | null>(
    null,
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const formModalWasOpen = useRef(false);
  const handledFetcherData = useRef<typeof fetcher.data>(undefined);

  const intent = String(fetcher.formData?.get('intent') || '');
  const saving =
    fetcher.state !== 'idle' &&
    (intent === 'create' || intent === 'update' || intent === 'delete');
  const toggling = fetcher.state !== 'idle' && intent === 'toggle';

  useEffect(() => {
    setBadges(initial);
  }, [initial]);

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (handledFetcherData.current === fetcher.data) return;
    handledFetcherData.current = fetcher.data;

    if (fetcher.data.ok) {
      const doneIntent =
        'intent' in fetcher.data ? String(fetcher.data.intent) : '';
      if (doneIntent === 'toggle' || doneIntent === 'reorder') {
        setTogglingId(null);
        revalidator.revalidate();
        return;
      }
      if (doneIntent === 'create') {
        shopify.toast.show('Badge created successfully!');
      } else if (doneIntent === 'update') {
        shopify.toast.show('Badge updated successfully!');
      } else if (doneIntent === 'delete') {
        shopify.toast.show('Badge deleted successfully!');
      }
      setModalOpen(false);
      setEditing(null);
      setSelectedIconFile(null);
      setDeletingBadge(null);
      setTogglingId(null);
      setFormError('');
      revalidator.revalidate();
      return;
    }
    if ('error' in fetcher.data && fetcher.data.error) {
      const msg = String(fetcher.data.error);
      const failedIntent =
        'intent' in fetcher.data ? String(fetcher.data.intent || '') : '';
      if (failedIntent === 'create' || failedIntent === 'update') {
        setFormError(msg);
      } else {
        shopify.toast.show(msg, {isError: true});
      }
      setTogglingId(null);
    }
  }, [fetcher.state, fetcher.data, revalidator, shopify]);

  useEffect(() => {
    const modal = document.getElementById(FORM_MODAL_ID) as ModalElement | null;
    if (!modal) return;
    if (modalOpen) {
      modal.showOverlay();
      formModalWasOpen.current = true;
      return;
    }
    if (formModalWasOpen.current) {
      modal.hideOverlay();
      formModalWasOpen.current = false;
    }
  }, [modalOpen]);

  const openCreate = () => {
    setEditing(null);
    setForm({...EMPTY_FORM});
    setSelectedIconFile(null);
    setLabelError('');
    setIconError('');
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (badge: TrustedBadgeSnake) => {
    setEditing(badge);
    setForm({
      icon_type: badge.icon_type,
      icon_value: badge.icon_value,
      label_text: badge.label_text,
      badge_color: badge.badge_color,
      text_color: badge.text_color,
      font_size: String(badge.font_size ?? 14),
      border_radius: String(badge.border_radius ?? 4),
      published: badge.published,
    });
    setSelectedIconFile(null);
    setLabelError('');
    setIconError('');
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setSelectedIconFile(null);
    setLabelError('');
    setIconError('');
    setFormError('');
  };

  const validateForm = () => {
    let ok = true;
    if (!form.label_text.trim()) {
      setLabelError('Badge text is required');
      ok = false;
    } else {
      setLabelError('');
    }
    if (
      form.icon_type === 'upload' &&
      !form.icon_value.trim() &&
      !selectedIconFile
    ) {
      setIconError('Custom icon upload is required');
      ok = false;
    } else {
      setIconError('');
    }
    return ok;
  };

  const saveBadge = () => {
    if (!validateForm()) return;
    setFormError('');
    const fd = new FormData();
    fd.set('intent', editing ? 'update' : 'create');
    if (editing) fd.set('id', editing.id);
    fd.set('icon_type', form.icon_type);
    // Never persist blob: preview URLs — upload file in the action instead.
    if (selectedIconFile) {
      fd.set('icon', selectedIconFile);
      fd.set(
        'icon_value',
        editing?.icon_type === 'upload' ? editing.icon_value : '',
      );
    } else {
      fd.set('icon_value', form.icon_value);
    }
    fd.set('label_text', form.label_text);
    fd.set('badge_color', form.badge_color);
    fd.set('text_color', form.text_color);
    fd.set('font_size', form.font_size);
    fd.set('border_radius', form.border_radius);
    fd.set('published', form.published ? 'true' : 'false');
    fetcher.submit(fd, {
      method: 'post',
      encType: 'multipart/form-data',
    });
  };

  const togglePublished = (badge: TrustedBadgeSnake) => {
    setTogglingId(badge.id);
    const fd = new FormData();
    fd.set('intent', 'toggle');
    fd.set('id', badge.id);
    fd.set('published', badge.published ? 'false' : 'true');
    fetcher.submit(fd, {method: 'post'});
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...badges];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setBadges(next);
    const fd = new FormData();
    fd.set('intent', 'reorder');
    fd.set('ordered_ids', JSON.stringify(next.map((b) => b.id)));
    fetcher.submit(fd, {method: 'post'});
  };

  const handleIconPick = (event: Event) => {
    const dropZone = event.currentTarget as DropZoneElement;
    const file = dropZone.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setIconError('File size must be less than 2MB');
      setSelectedIconFile(null);
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setSelectedIconFile(file);
    setForm((f) => ({...f, icon_type: 'upload', icon_value: localUrl}));
    setIconError('');
  };

  const previewIconValue =
    form.icon_type === 'upload' && selectedIconFile
      ? form.icon_value
      : form.icon_value;

  return (
    <s-page heading="Trusted Badges">
      <s-button slot="primary-action" variant="primary" icon="plus" onClick={openCreate}>
        Add badge
      </s-button>

      <s-section>
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Add trust badges to your storefront to increase customer confidence.
          </s-paragraph>

          {badges.length === 0 ? (
            <s-stack alignItems="center" gap="base" paddingBlock="large-400">
              <s-icon type="shield-check-mark" size="base" color="subdued" />
              <s-stack alignItems="center" gap="small">
                <s-heading>No trusted badges yet</s-heading>
                <s-text color="subdued">
                  Add trust badges to show customers why they should buy from
                  your store — secure payments, fast shipping, easy returns, and
                  more.
                </s-text>
              </s-stack>
              <s-button variant="primary" icon="plus" onClick={openCreate}>
                Add badge
              </s-button>
            </s-stack>
          ) : (
            <s-box padding="none" border="base" borderRadius="base" background="base">
              <s-stack gap="none">
                {badges.map((badge, index) => (
                  <s-box key={badge.id}>
                    {index > 0 ? <s-divider /> : null}
                    <s-box padding="base">
                      <s-stack
                        direction="inline"
                        gap="base"
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <s-stack
                          direction="inline"
                          gap="base"
                          alignItems="center"
                        >
                          <ListIconChip
                            badgeColor={badge.badge_color}
                            textColor={badge.text_color}
                            iconType={badge.icon_type}
                            iconValue={badge.icon_value}
                          />
                          <s-stack gap="small-300">
                            <s-text type="strong">{badge.label_text}</s-text>
                            <s-stack
                              direction="inline"
                              gap="small-200"
                              alignItems="center"
                            >
                              <s-text color="subdued">
                                {badge.icon_type === 'preset'
                                  ? `Icon: ${badge.icon_value}`
                                  : 'Custom icon'}
                              </s-text>
                              <s-badge
                                tone={badge.published ? 'success' : 'caution'}
                              >
                                {badge.published ? 'Published' : 'Hidden'}
                              </s-badge>
                            </s-stack>
                          </s-stack>
                        </s-stack>

                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="center"
                        >
                          <s-tooltip id={`move-up-${badge.id}`}>
                            Move up
                          </s-tooltip>
                          <s-button
                            variant="tertiary"
                            icon="arrow-up"
                            interestFor={`move-up-${badge.id}`}
                            accessibilityLabel="Move badge up"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          />
                          <s-tooltip id={`move-down-${badge.id}`}>
                            Move down
                          </s-tooltip>
                          <s-button
                            variant="tertiary"
                            icon="arrow-down"
                            interestFor={`move-down-${badge.id}`}
                            accessibilityLabel="Move badge down"
                            disabled={index === badges.length - 1}
                            onClick={() => move(index, 1)}
                          />
                          <s-button
                            variant="tertiary"
                            tone={badge.published ? 'critical' : undefined}
                            loading={toggling && togglingId === badge.id}
                            disabled={toggling && togglingId === badge.id}
                            onClick={() => togglePublished(badge)}
                          >
                            {badge.published ? 'Hide' : 'Show'}
                          </s-button>
                          <s-button
                            variant="tertiary"
                            icon="edit"
                            accessibilityLabel="Edit badge"
                            onClick={() => openEdit(badge)}
                          />
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            icon="delete"
                            accessibilityLabel="Delete badge"
                            onClick={() => setDeletingBadge(badge)}
                          />
                        </s-stack>
                      </s-stack>
                    </s-box>
                  </s-box>
                ))}
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-modal
        id={FORM_MODAL_ID}
        heading={editing ? 'Edit Badge' : 'Add New Badge'}
        onHide={closeModal}
      >
        <s-stack gap="base">
          {formError ? (
            <s-banner
              tone="critical"
              dismissible
              onDismiss={() => setFormError('')}
            >
              {formError}
            </s-banner>
          ) : null}

          <s-text-field
            label="Badge Text"
            value={form.label_text}
            placeholder="e.g. Secure Payment, Free Returns"
            error={labelError}
            required
            autocomplete="off"
            onInput={(e: Event) => {
              const label_text = fieldValue(e);
              setForm((f) => ({...f, label_text}));
              if (labelError) setLabelError('');
            }}
          />

          <s-select
            label="Icon Type"
            value={form.icon_type}
            onChange={(e: Event) => {
              const nextType = selectValue(e);
              setSelectedIconFile(null);
              setForm((f) => ({
                ...f,
                icon_type: nextType,
                icon_value: nextType === 'preset' ? 'shield' : '',
              }));
              setIconError('');
            }}
          >
            <s-option value="preset">Preset Icon</s-option>
            <s-option value="upload">Upload Custom Icon</s-option>
          </s-select>

          {form.icon_type === 'preset' ? (
            <>
              <s-stack gap="small">
                <s-text type="strong">Choose Icon</s-text>
                <ResponsiveGrid
                  gridTemplateColumns={COLS_ICON_PICKER}
                  gap="small-200"
                >
                  {PRESET_KEYS.map((key) => {
                    const selected = form.icon_value === key;
                    return (
                      <s-clickable
                        key={key}
                        padding="small-200"
                        border="base"
                        borderWidth={selected ? 'large' : 'base'}
                        borderColor={selected ? 'strong' : 'base'}
                        background={selected ? 'subdued' : 'transparent'}
                        borderRadius="base"
                        accessibilityLabel={titleCase(key)}
                        onClick={() =>
                          setForm((f) => ({...f, icon_value: key}))
                        }
                      >
                        <s-stack alignItems="center" justifyContent="center">
                          <PresetIcon name={key} size={24} />
                        </s-stack>
                      </s-clickable>
                    );
                  })}
                </ResponsiveGrid>
              </s-stack>
            </>
          ) : (
            <s-stack gap="small">
              <s-drop-zone
                label="Upload Icon"
                accept=".png,.jpg,.jpeg,.webp,.svg,.gif,image/*"
                error={iconError}
                disabled={saving}
                onChange={handleIconPick}
                onInput={handleIconPick}
                onDropRejected={() =>
                  setIconError(
                    'Only PNG, JPG, WEBP, SVG, or GIF images are accepted.',
                  )
                }
              />
              <s-paragraph color="subdued">
                PNG, JPG, WEBP, SVG, GIF up to 2MB.
              </s-paragraph>
              {previewIconValue ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <img
                    src={previewIconValue}
                    alt="Uploaded icon"
                    style={{width: 32, height: 32, objectFit: 'contain'}}
                  />
                  <s-text color="subdued">
                    {selectedIconFile ? 'Icon ready to upload' : 'Icon ready'}
                  </s-text>
                </s-stack>
              ) : null}
            </s-stack>
          )}

          <ResponsiveGrid
            gridTemplateColumns={COLS_2}
            gap="base"
          >
            <s-color-field
              label="Background Color"
              value={form.badge_color}
              onChange={(e: Event) => {
                const badge_color = fieldValue(e);
                setForm((f) => ({...f, badge_color}));
              }}
            />
            <s-color-field
              label="Icon & Text Color"
              value={form.text_color}
              onChange={(e: Event) => {
                const text_color = fieldValue(e);
                setForm((f) => ({...f, text_color}));
              }}
            />
          </ResponsiveGrid>

          <ResponsiveGrid
            gridTemplateColumns={COLS_2}
            gap="base"
          >
            <s-number-field
              label="Font size"
              value={form.font_size}
              min={10}
              max={32}
              step={1}
              suffix="px"
              inputMode="numeric"
              details="Applies to both icon and label text"
              onInput={(e: Event) => {
                const font_size = numberValue(e);
                setForm((f) => ({...f, font_size}));
              }}
            />
            <s-number-field
              label="Border radius"
              value={form.border_radius}
              min={0}
              max={40}
              step={1}
              suffix="px"
              inputMode="numeric"
              details="Corner roundness of the badge"
              onInput={(e: Event) => {
                const border_radius = numberValue(e);
                setForm((f) => ({...f, border_radius}));
              }}
            />
          </ResponsiveGrid>

          <s-checkbox
            label="Published (visible on storefront)"
            checked={form.published}
            onChange={(e: Event) => {
              const published = checkedValue(e);
              setForm((f) => ({...f, published}));
            }}
          />

          <s-stack gap="small">
            <s-text type="strong">Preview</s-text>
            <s-box
              padding="base"
              background="subdued"
              borderRadius="base"
            >
              <s-stack alignItems="center">
                <BadgeChipPreview
                  badgeColor={form.badge_color}
                  textColor={form.text_color}
                  iconType={form.icon_type}
                  iconValue={previewIconValue}
                  label={form.label_text}
                  fontSize={Number.parseInt(form.font_size, 10) || 14}
                  borderRadius={
                    Number.parseInt(form.border_radius, 10) || 0
                  }
                />
              </s-stack>
            </s-box>
          </s-stack>
        </s-stack>

        <s-button
          slot="primary-action"
          variant="primary"
          loading={saving}
          disabled={saving}
          onClick={saveBadge}
        >
          {editing ? 'Save Changes' : 'Add Badge'}
        </s-button>
        <s-button
          slot="secondary-actions"
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
        open={Boolean(deletingBadge)}
        heading="Delete Badge"
        message={
          deletingBadge
            ? `Are you sure you want to delete the badge "${deletingBadge.label_text}"? This action cannot be undone.`
            : 'This action cannot be undone.'
        }
        confirmLabel="Delete"
        loading={saving}
        onConfirm={() => {
          if (!deletingBadge) return;
          const fd = new FormData();
          fd.set('intent', 'delete');
          fd.set('id', deletingBadge.id);
          fetcher.submit(fd, {method: 'post'});
        }}
        onCancel={() => setDeletingBadge(null)}
      />
    </s-page>
  );
}
