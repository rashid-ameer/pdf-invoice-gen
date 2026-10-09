import {useEffect, useState} from 'react';
import type {ActionFunctionArgs, LoaderFunctionArgs} from 'react-router';
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from 'react-router';
import {SaveBar, useAppBridge} from '@shopify/app-bridge-react';
import {
  COLS_2,
  ResponsiveGrid,
} from '../components/layout/responsive-columns';
import {
  checkedValue,
  fieldValue,
  numberValue,
  selectValue,
} from '../utils/polaris-events';
import {requireExtraFeatureFlag} from '../models/shop-extra-features.server';
import {
  getWishlistSettings,
  saveWishlistSettings,
  type WishlistSettings,
} from '../models/wishlist-settings.server';
import {authenticate} from '../shopify.server';

const SAVE_BAR_ID = 'wishlist-settings-save-bar';

const ICON_PATHS = {
  heart:
    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
} as const;

function WishlistIcon({
  style,
  size,
  color,
  filled,
}: {
  style: string;
  size: number;
  color: string;
  filled: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{display: 'block', color}}
    >
      {style === 'star' ? (
        <polygon
          points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
          style={{
            fill: filled ? 'currentColor' : 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinejoin: 'round',
          }}
        />
      ) : (
        <path
          d={style === 'bookmark' ? ICON_PATHS.bookmark : ICON_PATHS.heart}
          style={{
            fill: filled ? 'currentColor' : 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinejoin: 'round',
          }}
        />
      )}
    </svg>
  );
}

function WishlistButtonPreview({
  settings,
  active,
  label,
}: {
  settings: WishlistSettings;
  active: boolean;
  label: string;
}) {
  const size = Math.max(10, Number(settings.iconSize) || 20);
  const pad = Math.max(0, Number(settings.padding) || 0);
  const radius = Math.max(0, Number(settings.borderRadius) || 0);

  return (
    <s-stack gap="small-200" alignItems="center">
      <s-text color="subdued">{label}</s-text>
      <button
        type="button"
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #e1e3e5',
          cursor: 'default',
          backgroundColor: active ? settings.bgColorActive : settings.bgColor,
          color: active ? settings.iconColorActive : settings.iconColor,
          padding: pad,
          borderRadius: `${radius}%`,
          lineHeight: 0,
        }}
      >
        <WishlistIcon
          style={settings.iconStyle}
          size={size}
          color={active ? settings.iconColorActive : settings.iconColor}
          filled={active}
        />
      </button>
    </s-stack>
  );
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'wishlistEnabled');
  return {settings: await getWishlistSettings(session.shop)};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'wishlistEnabled');
  const formData = await request.formData();
  await saveWishlistSettings(session.shop, {
    enabled: formData.get('enabled') === 'true',
    iconStyle: String(formData.get('iconStyle') || 'heart'),
    iconAnimation: String(formData.get('iconAnimation') || 'fill'),
    iconColor: String(formData.get('iconColor') || '#ff4757'),
    iconColorActive: String(formData.get('iconColorActive') || '#ffffff'),
    iconSize: Number(formData.get('iconSize') || 20),
    bgColor: String(formData.get('bgColor') || '#ffffff'),
    bgColorActive: String(formData.get('bgColorActive') || '#ff4757'),
    padding: Number(formData.get('padding') || 4),
    borderRadius: Number(formData.get('borderRadius') || 50),
    showOnHover: formData.get('showOnHover') === 'true',
  });
  return {ok: true};
};

export default function WishlistPage() {
  const {settings: saved} = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [settings, setSettings] = useState<WishlistSettings>(saved);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const saving =
    navigation.state === 'submitting' && navigation.formMethod === 'POST';

  useEffect(() => setSettings(saved), [saved]);
  useEffect(() => {
    if (actionData && 'ok' in actionData && actionData.ok) {
      shopify.toast.show('Wishlist settings saved');
    }
  }, [actionData, shopify]);

  useEffect(() => {
    const btn = document.querySelector(
      `#${SAVE_BAR_ID} [variant="primary"]`,
    ) as HTMLButtonElement | null;
    if (!btn) return;
    if (saving) btn.setAttribute('loading', 'true');
    else btn.removeAttribute('loading');
  }, [saving]);

  useEffect(() => {
    return () => {
      try {
        shopify.saveBar.hide(SAVE_BAR_ID);
      } catch {
        /* ignore */
      }
    };
  }, [shopify]);

  const patch = (partial: Partial<WishlistSettings>) =>
    setSettings((s) => ({...s, ...partial}));

  const onSave = () => {
    const fd = new FormData();
    fd.set('enabled', settings.enabled ? 'true' : 'false');
    fd.set('iconStyle', settings.iconStyle);
    fd.set('iconAnimation', settings.iconAnimation);
    fd.set('iconColor', settings.iconColor);
    fd.set('iconColorActive', settings.iconColorActive);
    fd.set('iconSize', String(settings.iconSize));
    fd.set('bgColor', settings.bgColor);
    fd.set('bgColorActive', settings.bgColorActive);
    fd.set('padding', String(settings.padding));
    fd.set('borderRadius', String(settings.borderRadius));
    fd.set('showOnHover', settings.showOnHover ? 'true' : 'false');
    submit(fd, {method: 'post'});
  };

  return (
    <s-page heading="Wishlist">
      <SaveBar id={SAVE_BAR_ID} open={dirty}>
        <button type="button" variant="primary" onClick={onSave} disabled={saving}>
          Save
        </button>
        <button
          type="button"
          onClick={() => setSettings(saved)}
          disabled={saving}
        >
          Discard
        </button>
      </SaveBar>

      <s-section>
        <s-banner tone="info">
          When enabled, a heart icon appears on every product card. Visitors can
          save products to their wishlist and add them to cart — no login
          required.
        </s-banner>
      </s-section>

      <s-section heading="General">
        <s-checkbox
          label="Enable Wishlist"
          details="Show wishlist icon on product cards and header."
          checked={settings.enabled}
          onChange={(e: Event) => patch({enabled: checkedValue(e)})}
        />
      </s-section>

      <s-section heading="Button Settings">
        <s-stack gap="base">
          <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
            <s-select
              label="Icon Style"
              value={settings.iconStyle}
              onChange={(e: Event) => patch({iconStyle: selectValue(e)})}
            >
              <s-option value="heart">Heart ♥</s-option>
              <s-option value="star">Star ☆</s-option>
              <s-option value="bookmark">Bookmark</s-option>
            </s-select>
            <s-select
              label="Icon Animation"
              value={settings.iconAnimation}
              onChange={(e: Event) => patch({iconAnimation: selectValue(e)})}
            >
              <s-option value="fill">Fill</s-option>
              <s-option value="stroke">Stroke</s-option>
              <s-option value="bounce">Bounce</s-option>
            </s-select>
          </ResponsiveGrid>

          <s-color-field
            label="Icon Color"
            value={settings.iconColor}
            details={`Current: ${settings.iconColor}`}
            onChange={(e: Event) => patch({iconColor: fieldValue(e)})}
          />
          <s-color-field
            label="Icon Color Active (when wishlisted)"
            value={settings.iconColorActive}
            details={`Current: ${settings.iconColorActive}`}
            onChange={(e: Event) => patch({iconColorActive: fieldValue(e)})}
          />

          <s-number-field
            label={`Icon Size: ${settings.iconSize}px`}
            value={String(settings.iconSize)}
            min={10}
            max={40}
            step={1}
            inputMode="numeric"
            suffix="px"
            onInput={(e: Event) => {
              const raw = numberValue(e);
              patch({iconSize: Number(raw) || 20});
            }}
          />

          <s-divider />

          <s-color-field
            label="Background Color"
            value={settings.bgColor}
            details={`Current: ${settings.bgColor}`}
            onChange={(e: Event) => patch({bgColor: fieldValue(e)})}
          />
          <s-color-field
            label="Background Color Active (when wishlisted)"
            value={settings.bgColorActive}
            details={`Current: ${settings.bgColorActive}`}
            onChange={(e: Event) => patch({bgColorActive: fieldValue(e)})}
          />

          <s-number-field
            label={`Padding: ${settings.padding}px`}
            value={String(settings.padding)}
            min={0}
            max={20}
            step={1}
            inputMode="numeric"
            suffix="px"
            onInput={(e: Event) => {
              const raw = numberValue(e);
              patch({padding: Number(raw) || 0});
            }}
          />
          <s-number-field
            label={`Border Radius: ${settings.borderRadius}%`}
            value={String(settings.borderRadius)}
            min={0}
            max={50}
            step={1}
            inputMode="numeric"
            suffix="%"
            onInput={(e: Event) => {
              const raw = numberValue(e);
              patch({borderRadius: Number(raw) || 0});
            }}
          />

          <s-checkbox
            label="Show When Hover"
            details="Only show the wishlist icon when hovering over a product card (desktop only)."
            checked={settings.showOnHover}
            onChange={(e: Event) => patch({showOnHover: checkedValue(e)})}
          />
        </s-stack>
      </s-section>

      <s-section heading="How It Works">
        <s-ordered-list>
          <s-list-item>Enable the wishlist from settings above</s-list-item>
          <s-list-item>Heart icon appears on every product card</s-list-item>
          <s-list-item>A heart counter appears in the store header</s-list-item>
          <s-list-item>Visitors click the heart to save products</s-list-item>
          <s-list-item>
            Click the header icon to open the wishlist modal
          </s-list-item>
          <s-list-item>
            Visitors can add saved items to cart or remove them
          </s-list-item>
        </s-ordered-list>
      </s-section>

      <s-box slot="aside">
        <s-section heading="Preview">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Live preview of the product-card wishlist button.
            </s-paragraph>
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack
                direction="inline"
                gap="large"
                alignItems="center"
                justifyContent="center"
              >
                <WishlistButtonPreview
                  settings={settings}
                  active={false}
                  label="Default"
                />
                <WishlistButtonPreview
                  settings={settings}
                  active
                  label="Wishlisted"
                />
              </s-stack>
            </s-box>
            {settings.showOnHover ? (
              <s-paragraph color="subdued">
                On the storefront, the icon only appears when hovering a product
                card (desktop).
              </s-paragraph>
            ) : null}
          </s-stack>
        </s-section>
      </s-box>
    </s-page>
  );
}
