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
  COLS_TIMER_LABELS,
  ResponsiveGrid,
} from '../components/layout/responsive-columns';

import {
  checkedValue,
  choiceValues,
  fieldValue,
  numberValue,
  selectValue,
} from '../utils/polaris-events';
import {requireExtraFeatureFlag} from '../models/shop-extra-features.server';
import {
  normalizeUpsellConfig,
  type UpsellConfig,
} from '../models/upsell-config';
import {
  getUpsellConfig,
  saveUpsellConfig,
} from '../models/upsell-config.server';
import {handleTimerChanges} from '../models/upsell-timers.server';
import {authenticate} from '../shopify.server';

const SAVE_BAR_ID = 'upsell-customize-save-bar';

type PickedItem = {
  id: string;
  title: string;
  imageUrl?: string;
};

type TimerProduct = {
  productId: string;
  variantId: string;
  title: string;
  imageUrl?: string;
  timerPrice: string;
};

type FormState = {
  appEnabled: boolean;
  internalOfferName: string;
  offerTitle: string;
  buttonText: string;

  triggerType: string;
  triggerProducts: PickedItem[];
  triggerCollections: PickedItem[];

  offerType: string;
  offerProducts: PickedItem[];
  offerCollections: PickedItem[];
  recommendationType: string;
  maxProducts: string;
  onlyInStock: boolean;
  hideAlreadyInCart: boolean;

  layoutType: string;
  showPrice: boolean;
  showComparePrice: boolean;
  showAddToCartButton: boolean;

  productPageEnabled: boolean;
  productPagePosition: string;
  cartPageEnabled: boolean;
  cartPagePosition: string;
  cartDrawerEnabled: boolean;
  cartDrawerPosition: string;

  spacingBetweenCards: string;
  spacingBottom: string;
  widgetPadding: string;
  titleSize: string;
  titleColor: string;
  widgetBackground: string;
  cardBackground: string;
  productTitleColor: string;
  comparePriceColor: string;
  priceColor: string;
  buttonBackground: string;
  buttonTextColor: string;
  buttonBorderColor: string;
  buttonBorderWidth: string;
  cardBorderRadius: string;
  buttonBorderRadius: string;
  imageBorderRadius: string;

  discountEnabled: boolean;
  discountThreshold: string;
  discountLabel: string;
  discountMessage: string;
  discountBg: string;
  discountTextColor: string;

  shippingEnabled: boolean;
  shippingThreshold: string;
  shippingProgressMessage: string;
  shippingUnlockedMessage: string;
  shippingBg: string;
  shippingFill: string;

  bundleEnabled: boolean;
  bundleTitle: string;
  bundleSubtitle: string;
  bundleProducts: PickedItem[];
  bundleBg: string;
  bundleTextColor: string;

  timerEnabled: boolean;
  timerMessage: string;
  timerCountdownDate: string;
  timerLabelD: string;
  timerLabelH: string;
  timerLabelM: string;
  timerLabelS: string;
  timerAfterEnds: string;
  timerEndMessage: string;
  timerBg: string;
  timerTextColor: string;
  timerProducts: TimerProduct[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function gidTail(gid: string): string {
  const parts = gid.split('/');
  return parts[parts.length - 1] || gid;
}

function itemsFromGids(
  gids: unknown,
  kind: 'Product' | 'Collection',
): PickedItem[] {
  return asArray(gids).map((raw) => {
    const id = String(raw);
    return {
      id,
      title: `${kind} #${gidTail(id)}`,
    };
  });
}

function timerProductsFromConfig(raw: unknown): TimerProduct[] {
  return asArray(raw).map((entry) => {
    const p = asRecord(entry);
    const productId = String(p.product_id || '');
    const variantId = String(p.variant_id || '');
    return {
      productId,
      variantId,
      title: variantId
        ? `Variant #${gidTail(variantId)}`
        : productId
          ? `Product #${gidTail(productId)}`
          : 'Timer product',
      timerPrice: String(p.timer_price ?? ''),
    };
  });
}

function configToForm(config: UpsellConfig): FormState {
  const features = asRecord(config.features);
  const discount = asRecord(features.discount_upsell);
  const discountRule = asRecord(asArray(discount.rules)[0]);
  const discountStyles = asRecord(discount.styles);
  const freeShipping = asRecord(features.free_shipping_bar);
  const freeShippingRule = asRecord(asArray(freeShipping.rules)[0]);
  const shippingStyles = asRecord(freeShipping.styles);
  const bundle = asRecord(features.bundle_offers);
  const bundleRule = asRecord(asArray(bundle.rules)[0]);
  const bundleStyles = asRecord(bundle.styles);
  const timer = asRecord(features.timer);
  const timerLabels = asRecord(timer.labels);
  const timerStyles = asRecord(timer.styles);
  const styles = asRecord(config.global_styles);
  const rule = asRecord(asArray(config.rules)[0]);
  const placement = asRecord(rule.placement);
  const productPage = asRecord(placement.product_page);
  const cartPage = asRecord(placement.cart_page);
  const cartDrawer = asRecord(placement.cart_drawer);
  const offer = asRecord(rule.offer);
  const trigger = asRecord(rule.trigger);
  const display = asRecord(rule.display);

  const layoutRaw = String(display.layout || 'carousel');
  const recommendationRaw = String(offer.recommendation_type || 'related');

  return {
    appEnabled: config.app_enabled !== false,
    internalOfferName: String(rule.name || 'Cart drawer'),
    offerTitle: String(display.title || 'You may also like'),
    buttonText: String(styles.button_text || 'Add'),

    triggerType: String(trigger.type || 'all_products'),
    triggerProducts: itemsFromGids(trigger.product_ids, 'Product'),
    triggerCollections: itemsFromGids(trigger.collection_ids, 'Collection'),

    offerType: String(offer.type || 'automated_recommendations'),
    offerProducts: itemsFromGids(offer.product_ids, 'Product'),
    offerCollections: itemsFromGids(offer.collection_ids, 'Collection'),
    recommendationType:
      recommendationRaw === 'complementary'
        ? 'complementary'
        : 'related',
    maxProducts: String(offer.max_products ?? 4),
    onlyInStock: offer.only_in_stock !== false,
    hideAlreadyInCart: offer.hide_already_in_cart === true,

    layoutType: layoutRaw === 'grid' ? 'stacked' : layoutRaw || 'carousel',
    showPrice: display.show_price !== false,
    showComparePrice: display.show_compare_price !== false,
    showAddToCartButton: display.show_add_to_cart_button !== false,

    productPageEnabled: productPage.enabled !== false,
    productPagePosition: String(
      productPage.position || 'below_add_to_cart',
    ),
    cartPageEnabled: cartPage.enabled !== false,
    cartPagePosition: String(
      cartPage.position || 'below_cart_items_above_checkout',
    ),
    cartDrawerEnabled: cartDrawer.enabled === true,
    cartDrawerPosition: String(
      cartDrawer.position || 'below_drawer_items',
    ),

    spacingBetweenCards: String(
      styles.outside_top || styles.spacing_between_cards || '16',
    ),
    spacingBottom: String(
      styles.outside_bottom || styles.spacing_between_cards || '16',
    ),
    widgetPadding: String(styles.widget_padding ?? '16'),
    titleSize: String(
      styles.title_font_size || styles.product_title_font_size || '14',
    ),
    titleColor: String(styles.title_color || '#1a1a1a'),
    widgetBackground: String(styles.widget_background || '#ffffff'),
    cardBackground: String(styles.card_background || '#f9f9f9'),
    productTitleColor: String(styles.product_title_color || '#1a1a1a'),
    comparePriceColor: String(styles.compare_price_color || '#999999'),
    priceColor: String(styles.price_color || '#333333'),
    buttonBackground: String(styles.button_background || '#000000'),
    buttonTextColor: String(styles.button_text_color || '#ffffff'),
    buttonBorderColor: String(
      styles.button_border_color || styles.card_border_color || '#e5e5e5',
    ),
    buttonBorderWidth: String(styles.button_border_width ?? '0'),
    cardBorderRadius: String(styles.card_border_radius || '12'),
    buttonBorderRadius: String(styles.button_border_radius || '8'),
    imageBorderRadius: String(styles.image_border_radius || '8'),

    discountEnabled: discount.enabled === true,
    discountThreshold: String(
      Number(discountRule.threshold_amount ?? 5000) / 100,
    ),
    discountLabel: String(discountRule.discount_label || '10% OFF'),
    discountMessage: String(
      discountRule.message_template ||
        'Add {remaining} more -> get {discount}',
    ),
    discountBg: String(discountStyles.background_color || '#fff7ed'),
    discountTextColor: String(discountStyles.text_color || '#7c2d12'),

    shippingEnabled: freeShipping.enabled === true,
    shippingThreshold: String(
      Number(freeShippingRule.threshold_amount ?? 30000) / 100,
    ),
    shippingProgressMessage: String(
      freeShippingRule.progress_message ||
        freeShippingRule.message_template ||
        'Spend {remaining} more to unlock FREE shipping',
    ),
    shippingUnlockedMessage: String(
      freeShippingRule.unlocked_message ||
        'You unlocked FREE shipping!',
    ),
    shippingBg: String(shippingStyles.background_color || '#ecfeff'),
    shippingFill: String(shippingStyles.progress_fill_color || '#06b6d4'),

    bundleEnabled: bundle.enabled === true,
    bundleTitle: String(bundleRule.title || 'Combo deal'),
    bundleSubtitle: String(bundleRule.subtitle || 'Buy 2 get 1 free'),
    bundleProducts: itemsFromGids(bundleRule.product_ids, 'Product'),
    bundleBg: String(bundleStyles.background_color || '#f5f3ff'),
    bundleTextColor: String(bundleStyles.text_color || '#4c1d95'),

    timerEnabled: timer.enabled === true,
    timerMessage: String(
      timer.message || 'This price expires in {timer}',
    ),
    timerCountdownDate: String(timer.countdown_date || ''),
    timerLabelD: String(timerLabels.d || 'd'),
    timerLabelH: String(timerLabels.h || 'h'),
    timerLabelM: String(timerLabels.m || 'm'),
    timerLabelS: String(timerLabels.s || 's'),
    timerAfterEnds: String(timer.after_timer_ends || 'show_message'),
    timerEndMessage: String(
      timer.end_message || 'This offer has expired',
    ),
    timerBg: String(timerStyles.background_color || '#1a1a1a'),
    timerTextColor: String(timerStyles.text_color || '#ffffff'),
    timerProducts: timerProductsFromConfig(timer.products),
  };
}

function formToConfig(form: FormState, previous: UpsellConfig): UpsellConfig {
  const base = normalizeUpsellConfig(previous);
  const features = asRecord(base.features);
  const discount = asRecord(features.discount_upsell);
  const discountRule = asRecord(asArray(discount.rules)[0]);
  const discountStyles = asRecord(discount.styles);
  const freeShipping = asRecord(features.free_shipping_bar);
  const freeShippingRule = asRecord(asArray(freeShipping.rules)[0]);
  const shippingStyles = asRecord(freeShipping.styles);
  const bundle = asRecord(features.bundle_offers);
  const bundleRule = asRecord(asArray(bundle.rules)[0]);
  const bundleStyles = asRecord(bundle.styles);
  const timer = asRecord(features.timer);
  const timerLabels = asRecord(timer.labels);
  const timerStyles = asRecord(timer.styles);
  const styles = asRecord(base.global_styles);
  const rule = asRecord(asArray(base.rules)[0]);
  const placement = asRecord(rule.placement);
  const offer = asRecord(rule.offer);
  const trigger = asRecord(rule.trigger);
  const display = asRecord(rule.display);

  return normalizeUpsellConfig({
    ...base,
    app_enabled: form.appEnabled,
    global_styles: {
      ...styles,
      widget_background: form.widgetBackground,
      widget_padding: form.widgetPadding,
      title_color: form.titleColor,
      title_font_size: form.titleSize,
      title_alignment: String(styles.title_alignment || 'left'),
      price_color: form.priceColor,
      compare_price_color: form.comparePriceColor,
      card_background: form.cardBackground,
      card_border_radius: form.cardBorderRadius,
      card_border_color: form.buttonBorderColor,
      card_hover_shadow: styles.card_hover_shadow ?? true,
      button_background: form.buttonBackground,
      button_text_color: form.buttonTextColor,
      button_border_radius: form.buttonBorderRadius,
      button_border_color: form.buttonBorderColor,
      button_border_width: form.buttonBorderWidth,
      button_text: form.buttonText,
      image_border_radius: form.imageBorderRadius,
      image_aspect_ratio: String(styles.image_aspect_ratio || '1/1'),
      product_title_color: form.productTitleColor,
      product_title_font_size: form.titleSize,
      spacing_between_cards: form.spacingBetweenCards,
      outside_top: form.spacingBetweenCards,
      outside_bottom: form.spacingBottom,
      custom_css: String(styles.custom_css || ''),
    },
    features: {
      ...features,
      discount_upsell: {
        ...discount,
        enabled: form.discountEnabled,
        rules: [
          {
            ...discountRule,
            id: String(discountRule.id || 'discount_rule_1'),
            enabled: true,
            threshold_amount: Math.round(
              (Number(form.discountThreshold) || 50) * 100,
            ),
            discount_label: form.discountLabel,
            message_template: form.discountMessage,
            placement: asRecord(discountRule.placement).page
              ? discountRule.placement
              : {
                  page: 'cart_page',
                  position: 'below_cart_items_above_checkout',
                },
          },
        ],
        styles: {
          ...discountStyles,
          background_color: form.discountBg,
          text_color: form.discountTextColor,
        },
      },
      free_shipping_bar: {
        ...freeShipping,
        enabled: form.shippingEnabled,
        rules: [
          {
            ...freeShippingRule,
            id: String(freeShippingRule.id || 'shipping_rule_1'),
            enabled: true,
            threshold_amount: Math.round(
              (Number(form.shippingThreshold) || 300) * 100,
            ),
            progress_message: form.shippingProgressMessage,
            unlocked_message: form.shippingUnlockedMessage,
            message_template: form.shippingProgressMessage,
            placement: asRecord(freeShippingRule.placement).page
              ? freeShippingRule.placement
              : {
                  page: 'cart_page',
                  position: 'below_cart_items_above_checkout',
                },
          },
        ],
        styles: {
          ...shippingStyles,
          background_color: form.shippingBg,
          progress_fill_color: form.shippingFill,
        },
      },
      bundle_offers: {
        ...bundle,
        enabled: form.bundleEnabled,
        rules: [
          {
            ...bundleRule,
            id: String(bundleRule.id || 'bundle_rule_1'),
            enabled: true,
            title: form.bundleTitle,
            subtitle: form.bundleSubtitle,
            product_ids: form.bundleProducts.map((p) => p.id),
            placement: asRecord(bundleRule.placement).page
              ? bundleRule.placement
              : {
                  page: 'product_page',
                  position: 'below_add_to_cart',
                },
          },
        ],
        styles: {
          ...bundleStyles,
          background_color: form.bundleBg,
          text_color: form.bundleTextColor,
        },
      },
      timer: {
        ...timer,
        enabled: form.timerEnabled,
        message: form.timerMessage,
        timer_type: 'countdown_to_date',
        countdown_date: form.timerCountdownDate,
        labels: {
          ...timerLabels,
          d: form.timerLabelD,
          h: form.timerLabelH,
          m: form.timerLabelM,
          s: form.timerLabelS,
        },
        after_timer_ends: form.timerAfterEnds,
        end_message: form.timerEndMessage,
        products: form.timerProducts.map((p) => ({
          product_id: p.productId,
          variant_id: p.variantId,
          timer_price: parseFloat(p.timerPrice) || 0,
        })),
        styles: {
          ...timerStyles,
          background_color: form.timerBg,
          text_color: form.timerTextColor,
          padding: String(timerStyles.padding || '12'),
        },
      },
    },
    rules: [
      {
        ...rule,
        id: String(rule.id || 'rule_1'),
        enabled: rule.enabled !== false,
        name: form.internalOfferName || String(rule.name || 'Upsell Rule'),
        priority: Number(rule.priority) || 1,
        trigger: {
          ...trigger,
          type: form.triggerType || 'all_products',
          product_ids: form.triggerProducts.map((p) => p.id),
          collection_ids: form.triggerCollections.map((c) => c.id),
        },
        offer: {
          ...offer,
          type: form.offerType || 'automated_recommendations',
          product_ids: form.offerProducts.map((p) => p.id),
          collection_ids: form.offerCollections.map((c) => c.id),
          recommendation_type: form.recommendationType || 'related',
          max_products: Number(form.maxProducts) || 4,
          only_in_stock: form.onlyInStock,
          hide_already_in_cart: form.hideAlreadyInCart,
        },
        display: {
          ...display,
          title: form.offerTitle || 'You may also like',
          layout: form.layoutType === 'stacked' ? 'grid' : form.layoutType,
          show_price: form.showPrice,
          show_compare_price: form.showComparePrice,
          show_add_to_cart_button: form.showAddToCartButton,
        },
        placement: {
          ...placement,
          product_page: {
            ...asRecord(placement.product_page),
            enabled: form.productPageEnabled,
            position: form.productPagePosition || 'below_add_to_cart',
          },
          cart_page: {
            ...asRecord(placement.cart_page),
            enabled: form.cartPageEnabled,
            position:
              form.cartPagePosition || 'below_cart_items_above_checkout',
          },
          cart_drawer: {
            ...asRecord(placement.cart_drawer),
            enabled: form.cartDrawerEnabled,
            position: form.cartDrawerPosition || 'below_drawer_items',
          },
        },
      },
    ],
  });
}

type PickerProduct = {
  id?: string;
  title?: string;
  images?: Array<{originalSrc?: string}>;
  variants?: Array<{id?: string; price?: string}>;
};

type PickerCollection = {
  id?: string;
  title?: string;
  image?: {originalSrc?: string};
};

function mapPickerProducts(selected: PickerProduct[]): PickedItem[] {
  return selected
    .filter((p) => p.id)
    .map((p) => ({
      id: String(p.id),
      title: String(p.title || `Product #${gidTail(String(p.id))}`),
      imageUrl: p.images?.[0]?.originalSrc,
    }));
}

function mapPickerCollections(selected: PickerCollection[]): PickedItem[] {
  return selected
    .filter((c) => c.id)
    .map((c) => ({
      id: String(c.id),
      title: String(c.title || `Collection #${gidTail(String(c.id))}`),
      imageUrl: c.image?.originalSrc,
    }));
}

/** Normalize stored countdown values for `<input type="datetime-local">`. */
function toDatetimeLocalValue(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    return raw.slice(0, 16);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Live helper text for spend thresholds entered in major currency units. */
function thresholdDetails(raw: string) {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) {
    return 'Enter the amount in dollars (e.g. 50).';
  }
  const dollars = amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Cart must reach ${dollars}`;
}

function SelectedList({
  items,
  onRemove,
}: {
  items: PickedItem[];
  onRemove: (id: string) => void;
}) {
  if (!items.length) {
    return (
      <s-paragraph color="subdued">None selected yet.</s-paragraph>
    );
  }
  return (
    <s-stack gap="small">
      {items.map((item) => (
        <s-box
          key={item.id}
          padding="small"
          border="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="inline" gap="base" alignItems="center">
            {item.imageUrl ? (
              <s-thumbnail
                src={item.imageUrl}
                alt={item.title}
                size="small"
              />
            ) : null}
            <s-stack gap="none">
              <s-text type="strong">{item.title}</s-text>
              <s-text color="subdued">{item.id}</s-text>
            </s-stack>
            <s-button
              tone="critical"
              variant="tertiary"
              icon="delete"
              accessibilityLabel={`Remove ${item.title}`}
              onClick={() => onRemove(item.id)}
            />
          </s-stack>
        </s-box>
      ))}
    </s-stack>
  );
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {admin, session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'upsellEnabled');
  const config = await getUpsellConfig(admin);
  return {config};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {admin, session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'upsellEnabled');

  const formData = await request.formData();
  let config: UpsellConfig;
  try {
    config = normalizeUpsellConfig(
      JSON.parse(String(formData.get('config') || '{}')),
    );
  } catch {
    return {ok: false, error: 'Invalid config JSON'};
  }

  try {
    const saved = await saveUpsellConfig(admin, config);
    const timer = asRecord(asRecord(saved.features).timer);
    await handleTimerChanges(admin, session.shop, {
      enabled: timer.enabled === true,
      countdown_date: String(timer.countdown_date || ''),
      products: asArray(timer.products) as Array<{
        product_id?: string;
        variant_id?: string;
        timer_price?: number | string;
      }>,
    });
    return {ok: true, config: saved};
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Save failed',
    };
  }
};

export default function UpsellCustomizePage() {
  const {config: savedConfig} = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [baseline, setBaseline] = useState(savedConfig);
  const [form, setForm] = useState(() => configToForm(savedConfig));
  const [selectedTab, setSelectedTab] = useState(0);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(configToForm(baseline));
  const saving =
    navigation.state === 'submitting' && navigation.formMethod === 'POST';

  useEffect(() => {
    setBaseline(savedConfig);
    setForm(configToForm(savedConfig));
  }, [savedConfig]);

  useEffect(() => {
    if (actionData && 'ok' in actionData && actionData.ok && actionData.config) {
      setBaseline(actionData.config);
      setForm(configToForm(actionData.config));
      shopify.toast.show('Upsell settings saved');
    } else if (actionData && 'ok' in actionData && !actionData.ok) {
      shopify.toast.show(actionData.error || 'Save failed', {isError: true});
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

  const patch = (partial: Partial<FormState>) =>
    setForm((f) => ({...f, ...partial}));

  const pickProducts = async (
    current: PickedItem[],
    onDone: (items: PickedItem[]) => void,
    multiple = true,
  ) => {
    try {
      const selected = await shopify.resourcePicker({
        type: 'product',
        multiple,
        action: 'select',
        selectionIds: current.map((p) => ({id: p.id})),
      });
      if (!selected || !Array.isArray(selected)) return;
      onDone(mapPickerProducts(selected as PickerProduct[]));
    } catch {
      /* cancelled */
    }
  };

  const pickCollections = async (
    current: PickedItem[],
    onDone: (items: PickedItem[]) => void,
  ) => {
    try {
      const selected = await shopify.resourcePicker({
        type: 'collection',
        multiple: true,
        action: 'select',
        selectionIds: current.map((c) => ({id: c.id})),
      });
      if (!selected || !Array.isArray(selected)) return;
      onDone(mapPickerCollections(selected as PickerCollection[]));
    } catch {
      /* cancelled */
    }
  };

  const pickTimerProducts = async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: 'product',
        multiple: true,
        action: 'select',
        filter: {variants: true},
        selectionIds: form.timerProducts
          .filter((p) => p.productId)
          .map((p) => ({
            id: p.productId,
            variants: p.variantId ? [{id: p.variantId}] : undefined,
          })),
      });
      if (!selected || !Array.isArray(selected)) return;
      const existingByVariant = new Map(
        form.timerProducts.map((p) => [p.variantId, p]),
      );
      const next: TimerProduct[] = [];
      for (const product of selected as PickerProduct[]) {
        if (!product.id) continue;
        const variants = product.variants?.length
          ? product.variants
          : [{id: product.id, price: '0'}];
        for (const variant of variants) {
          const variantId = String(variant.id || product.id);
          const prev = existingByVariant.get(variantId);
          next.push({
            productId: String(product.id),
            variantId,
            title: String(
              product.title || `Product #${gidTail(String(product.id))}`,
            ),
            imageUrl: product.images?.[0]?.originalSrc,
            timerPrice:
              prev?.timerPrice ||
              (variant.price != null ? String(variant.price) : '0'),
          });
        }
      }
      patch({timerProducts: next});
    } catch {
      /* cancelled */
    }
  };

  const onSave = () => {
    const config = formToConfig(form, baseline);
    const fd = new FormData();
    fd.set('config', JSON.stringify(config));
    submit(fd, {method: 'post'});
  };

  const togglePublish = () => {
    const next = !form.appEnabled;
    patch({appEnabled: next});
    const config = formToConfig({...form, appEnabled: next}, baseline);
    const fd = new FormData();
    fd.set('config', JSON.stringify(config));
    submit(fd, {method: 'post'});
  };

  return (
    <s-page heading="Upsell rule customization">
      <s-link slot="breadcrumb-actions" href="/app/upsell">
        Upsell
      </s-link>
      <s-button
        slot="secondary-actions"
        // @ts-expect-error -- suppressHydrationWarning isn't modeled by @shopify/polaris-types
        suppressHydrationWarning
        onClick={togglePublish}
        disabled={saving}
      >
        {form.appEnabled ? 'Unpublish' : 'Publish'}
      </s-button>
      <SaveBar id={SAVE_BAR_ID} open={dirty}>
        <button type="button" variant="primary" onClick={onSave} disabled={saving}>
          Save
        </button>
        <button
          type="button"
          onClick={() => setForm(configToForm(baseline))}
          disabled={saving}
        >
          Discard
        </button>
      </SaveBar>

      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          marginBottom: 16,
          paddingBottom: 8,
          background: 'var(--p-color-bg, #f1f1f1)',
        }}
      >
        <s-section heading="Preview">
          <div
            style={{
              padding: `${form.widgetPadding || 16}px`,
              background: form.widgetBackground || '#ffffff',
              borderRadius: 8,
              border: '1px solid #e1e3e5',
              overflow: 'hidden',
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                gap: 12,
              }}
            >
              <div
                style={{
                  color: form.titleColor || '#1a1a1a',
                  fontSize: `${form.titleSize || 14}px`,
                  fontWeight: 600,
                  lineHeight: 1.2,
                }}
              >
                {form.offerTitle || 'You may also like'}
              </div>
              {form.layoutType !== 'stacked' ? (
                <div style={{display: 'flex', gap: 8, flexShrink: 0}}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: form.titleColor || '#1a1a1a',
                      fontSize: 18,
                      lineHeight: 1,
                      opacity: 0.85,
                      userSelect: 'none',
                    }}
                    aria-hidden
                  >
                    ‹
                  </span>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: form.titleColor || '#1a1a1a',
                      fontSize: 18,
                      lineHeight: 1,
                      opacity: 0.85,
                      userSelect: 'none',
                    }}
                    aria-hidden
                  >
                    ›
                  </span>
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: form.layoutType === 'stacked' ? 'grid' : 'flex',
                gridTemplateColumns: '1fr',
                flexDirection: 'row',
                gap: `${form.spacingBetweenCards || 16}px`,
                overflow: 'hidden',
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              {(form.layoutType === 'stacked'
                ? [1, 2]
                : [1]
              ).map((n) => (
                <div
                  key={n}
                  style={{
                    flex: '1 1 auto',
                    width: '100%',
                    maxWidth: '100%',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    background: form.cardBackground || '#ffffff',
                    borderRadius: `${form.cardBorderRadius || 12}px`,
                    border: `1px solid ${form.buttonBorderColor || '#e5e5e5'}`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      minWidth: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        flexShrink: 0,
                        borderRadius: `${form.imageBorderRadius || 8}px`,
                        background:
                          'linear-gradient(135deg, #c4a484 0%, #8b6914 100%)',
                      }}
                      aria-hidden
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          color: form.productTitleColor || '#1a1a1a',
                          fontSize: 14,
                          fontWeight: 500,
                          lineHeight: 1.3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Red Wing Iron Ranger Boot
                      </div>
                      {form.showPrice ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'baseline',
                          }}
                        >
                          <span
                            style={{
                              color: form.priceColor || '#333333',
                              fontWeight: 700,
                              fontSize: 14,
                            }}
                          >
                            294.50
                          </span>
                          {form.showComparePrice ? (
                            <span
                              style={{
                                color: form.comparePriceColor || '#999999',
                                textDecoration: 'line-through',
                                fontSize: 12,
                              }}
                            >
                              349.00
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {form.showAddToCartButton ? (
                      <button
                        type="button"
                        style={{
                          flexShrink: 0,
                          border: `${form.buttonBorderWidth || 0}px solid ${form.buttonBorderColor || '#e5e5e5'}`,
                          background: form.buttonBackground || '#000000',
                          color: form.buttonTextColor || '#ffffff',
                          borderRadius: `${form.buttonBorderRadius || 8}px`,
                          padding: '8px 16px',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'default',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        + {form.buttonText || 'Add to Cart'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </s-section>
      </div>

      <s-section>
        <s-stack direction="inline" gap="small">
          <s-button
            variant={selectedTab === 0 ? 'primary' : 'secondary'}
            onClick={() => setSelectedTab(0)}
          >
            Upsell
          </s-button>
          <s-button
            variant={selectedTab === 1 ? 'primary' : 'secondary'}
            onClick={() => setSelectedTab(1)}
          >
            Design
          </s-button>
          <s-button
            variant={selectedTab === 2 ? 'primary' : 'secondary'}
            onClick={() => setSelectedTab(2)}
          >
            Additional features
          </s-button>
        </s-stack>
      </s-section>

      {selectedTab === 0 ? (
        <>
      <s-section heading="Enable">
        <s-switch
          label="Enable upsell app"
          details="When off, storefront widgets stay hidden."
          checked={form.appEnabled}
          onChange={(e: Event) => patch({appEnabled: checkedValue(e)})}
        />
      </s-section>

      <s-section heading="Offer names">
        <s-stack gap="base">
          <s-text-field
            label="Internal offer name"
            details="Only visible to you in the offer list"
            value={form.internalOfferName}
            onInput={(e: Event) =>
              patch({internalOfferName: fieldValue(e)})
            }
          />
          <s-text-field
            label="Offer name"
            details="Displayed above the widget"
            value={form.offerTitle}
            onInput={(e: Event) => patch({offerTitle: fieldValue(e)})}
          />
          <s-text-field
            label="Button text"
            value={form.buttonText}
            onInput={(e: Event) => patch({buttonText: fieldValue(e)})}
          />
        </s-stack>
      </s-section>

      <s-section heading="Trigger">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            The offer will be displayed on trigger product pages.
          </s-paragraph>
          <s-choice-list
            label="Trigger type"
            name="trigger-type"
            values={[form.triggerType]}
            onChange={(e: Event) => {
              const values = choiceValues(e);
              if (values[0]) patch({triggerType: values[0]});
            }}
          >
            <s-choice value="all_products">All products</s-choice>
            <s-choice value="specific_products">Specific products</s-choice>
            <s-choice value="specific_collections">
              Specific collections
            </s-choice>
          </s-choice-list>

          {form.triggerType === 'specific_products' ? (
            <s-stack gap="small">
              <s-button
                onClick={() =>
                  pickProducts(form.triggerProducts, (items) =>
                    patch({triggerProducts: items}),
                  )
                }
              >
                Browse products
              </s-button>
              <SelectedList
                items={form.triggerProducts}
                onRemove={(id) =>
                  patch({
                    triggerProducts: form.triggerProducts.filter(
                      (p) => p.id !== id,
                    ),
                  })
                }
              />
            </s-stack>
          ) : null}

          {form.triggerType === 'specific_collections' ? (
            <s-stack gap="small">
              <s-button
                onClick={() =>
                  pickCollections(form.triggerCollections, (items) =>
                    patch({triggerCollections: items}),
                  )
                }
              >
                Browse collections
              </s-button>
              <SelectedList
                items={form.triggerCollections}
                onRemove={(id) =>
                  patch({
                    triggerCollections: form.triggerCollections.filter(
                      (c) => c.id !== id,
                    ),
                  })
                }
              />
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Offer">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Only offer items that are in stock will be displayed in the cart.
          </s-paragraph>
          <s-choice-list
            label="Offer type"
            name="offer-type"
            values={[form.offerType]}
            onChange={(e: Event) => {
              const values = choiceValues(e);
              if (values[0]) patch({offerType: values[0]});
            }}
          >
            <s-choice value="specific_products">Specific products</s-choice>
            <s-choice value="specific_collections">
              Specific collections
            </s-choice>
            <s-choice value="automated_recommendations">
              Automated recommendations
            </s-choice>
          </s-choice-list>

          {form.offerType === 'specific_products' ? (
            <s-stack gap="small">
              <s-button
                onClick={() =>
                  pickProducts(form.offerProducts, (items) =>
                    patch({offerProducts: items}),
                  )
                }
              >
                Browse products
              </s-button>
              <SelectedList
                items={form.offerProducts}
                onRemove={(id) =>
                  patch({
                    offerProducts: form.offerProducts.filter(
                      (p) => p.id !== id,
                    ),
                  })
                }
              />
            </s-stack>
          ) : null}

          {form.offerType === 'specific_collections' ? (
            <s-stack gap="small">
              <s-button
                onClick={() =>
                  pickCollections(form.offerCollections, (items) =>
                    patch({offerCollections: items}),
                  )
                }
              >
                Browse collections
              </s-button>
              <SelectedList
                items={form.offerCollections}
                onRemove={(id) =>
                  patch({
                    offerCollections: form.offerCollections.filter(
                      (c) => c.id !== id,
                    ),
                  })
                }
              />
            </s-stack>
          ) : null}

          {form.offerType === 'automated_recommendations' ? (
            <s-choice-list
              label="Recommendation type"
              name="recommendation-type"
              values={[form.recommendationType]}
              onChange={(e: Event) => {
                const values = choiceValues(e);
                if (values[0]) patch({recommendationType: values[0]});
              }}
            >
              <s-choice value="related">Related products</s-choice>
              <s-choice value="complementary">
                Complementary products
              </s-choice>
            </s-choice-list>
          ) : null}

          <s-number-field
            label="Max products"
            value={form.maxProducts}
            min={1}
            max={20}
            step={1}
            inputMode="numeric"
            onInput={(e: Event) => patch({maxProducts: numberValue(e)})}
          />
          <s-switch
            label="Only in-stock products"
            checked={form.onlyInStock}
            onChange={(e: Event) => patch({onlyInStock: checkedValue(e)})}
          />
          <s-heading>Offer visibility</s-heading>
          <s-checkbox
            label="Hide products that are already in cart"
            checked={form.hideAlreadyInCart}
            onChange={(e: Event) =>
              patch({hideAlreadyInCart: checkedValue(e)})
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Placement">
        <s-stack gap="base">
          <s-switch
            label="Product page"
            checked={form.productPageEnabled}
            onChange={(e: Event) =>
              patch({productPageEnabled: checkedValue(e)})
            }
          />
          {form.productPageEnabled ? (
            <s-select
              label="Product page position"
              value={form.productPagePosition}
              onChange={(e: Event) =>
                patch({productPagePosition: selectValue(e)})
              }
            >
              <s-option value="below_add_to_cart">
                Below Add to Cart (recommended)
              </s-option>
              <s-option value="below_description">Below description</s-option>
              <s-option value="below_reviews">Below reviews</s-option>
            </s-select>
          ) : null}

          <s-switch
            label="Cart page"
            checked={form.cartPageEnabled}
            onChange={(e: Event) =>
              patch({cartPageEnabled: checkedValue(e)})
            }
          />
          {form.cartPageEnabled ? (
            <s-select
              label="Cart page position"
              value={form.cartPagePosition}
              onChange={(e: Event) =>
                patch({cartPagePosition: selectValue(e)})
              }
            >
              <s-option value="below_cart_items_above_checkout">
                Below cart items above checkout (recommended)
              </s-option>
              <s-option value="above_cart_items">Above cart items</s-option>
              <s-option value="below_checkout">Below checkout</s-option>
            </s-select>
          ) : null}

          <s-switch
            label="Cart drawer"
            checked={form.cartDrawerEnabled}
            onChange={(e: Event) =>
              patch({cartDrawerEnabled: checkedValue(e)})
            }
          />
          {form.cartDrawerEnabled ? (
            <s-select
              label="Cart drawer position"
              value={form.cartDrawerPosition}
              onChange={(e: Event) =>
                patch({cartDrawerPosition: selectValue(e)})
              }
            >
              <s-option value="below_drawer_items">
                Below drawer items (recommended)
              </s-option>
              <s-option value="above_subtotal">Above subtotal</s-option>
            </s-select>
          ) : null}
        </s-stack>
      </s-section>
        </>
      ) : null}

      {selectedTab === 1 ? (
        <>
      <s-section heading="Layout">
        <s-stack gap="base">
          <s-select
            label="Layout type"
            value={form.layoutType}
            onChange={(e: Event) => patch({layoutType: selectValue(e)})}
          >
            <s-option value="carousel">Carousel</s-option>
            <s-option value="stacked">Stacked</s-option>
          </s-select>
          <s-checkbox
            label="Show price"
            checked={form.showPrice}
            onChange={(e: Event) => patch({showPrice: checkedValue(e)})}
          />
          <s-checkbox
            label="Show compare-at price"
            checked={form.showComparePrice}
            onChange={(e: Event) =>
              patch({showComparePrice: checkedValue(e)})
            }
          />
          <s-checkbox
            label="Show add to cart button"
            checked={form.showAddToCartButton}
            onChange={(e: Event) =>
              patch({showAddToCartButton: checkedValue(e)})
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Spacing">
        <s-stack gap="base">
          <s-text>Spacing</s-text>
          <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
            <s-number-field
              label="Outside top"
              value={form.spacingBetweenCards}
              min={0}
              max={100}
              step={1}
              suffix="px"
              inputMode="numeric"
              onInput={(e: Event) =>
                patch({spacingBetweenCards: numberValue(e)})
              }
            />
            <s-number-field
              label="Outside bottom"
              value={form.spacingBottom}
              min={0}
              max={100}
              step={1}
              suffix="px"
              inputMode="numeric"
              onInput={(e: Event) =>
                patch({spacingBottom: numberValue(e)})
              }
            />
          </ResponsiveGrid>
          <s-number-field
            label="Widget padding"
            value={form.widgetPadding}
            min={0}
            max={100}
            step={1}
            suffix="px"
            inputMode="numeric"
            onInput={(e: Event) => patch({widgetPadding: numberValue(e)})}
          />
        </s-stack>
      </s-section>

      <s-section heading="Upsell Design">
        <s-stack gap="base">
          <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
            <s-stack gap="small-200">
              <s-text>Title style</s-text>
              <s-stack direction="inline" gap="small" alignItems="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    border: '1px solid #8c9196',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    flex: '0 0 32px',
                  }}
                >
                  B
                </div>
                <s-number-field
                  label="Title size"
                  value={form.titleSize}
                  min={8}
                  max={72}
                  step={1}
                  suffix="px"
                  inputMode="numeric"
                  onInput={(e: Event) => patch({titleSize: numberValue(e)})}
                />
              </s-stack>
            </s-stack>
            <s-color-field
              label="Title color"
              value={form.titleColor}
              onChange={(e: Event) => patch({titleColor: fieldValue(e)})}
            />
          </ResponsiveGrid>
          <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
            <s-color-field
              label="Offer background"
              value={form.widgetBackground}
              onChange={(e: Event) =>
                patch({widgetBackground: fieldValue(e)})
              }
            />
            <s-color-field
              label="Product card background"
              value={form.cardBackground}
              onChange={(e: Event) => patch({cardBackground: fieldValue(e)})}
            />
          </ResponsiveGrid>
          <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
            <s-color-field
              label="Primary text"
              value={form.productTitleColor}
              onChange={(e: Event) =>
                patch({productTitleColor: fieldValue(e)})
              }
            />
            <s-color-field
              label="Secondary text"
              value={form.comparePriceColor}
              onChange={(e: Event) =>
                patch({comparePriceColor: fieldValue(e)})
              }
            />
          </ResponsiveGrid>
          <s-color-field
            label="Price color"
            value={form.priceColor}
            onChange={(e: Event) => patch({priceColor: fieldValue(e)})}
          />
          <s-number-field
            label="Card border radius"
            value={form.cardBorderRadius}
            min={0}
            max={40}
            step={1}
            suffix="px"
            inputMode="numeric"
            onInput={(e: Event) =>
              patch({cardBorderRadius: numberValue(e)})
            }
          />
          <s-number-field
            label="Image border radius"
            value={form.imageBorderRadius}
            min={0}
            max={40}
            step={1}
            suffix="px"
            inputMode="numeric"
            onInput={(e: Event) =>
              patch({imageBorderRadius: numberValue(e)})
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Button">
        <s-stack gap="base">
          <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
            <s-color-field
              label="Background"
              value={form.buttonBackground}
              onChange={(e: Event) =>
                patch({buttonBackground: fieldValue(e)})
              }
            />
            <s-color-field
              label="Text"
              value={form.buttonTextColor}
              onChange={(e: Event) =>
                patch({buttonTextColor: fieldValue(e)})
              }
            />
          </ResponsiveGrid>
          <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
            <s-color-field
              label="Border color"
              value={form.buttonBorderColor}
              onChange={(e: Event) =>
                patch({buttonBorderColor: fieldValue(e)})
              }
            />
            <s-number-field
              label="Border size"
              value={form.buttonBorderWidth}
              min={0}
              max={20}
              step={1}
              suffix="px"
              inputMode="numeric"
              onInput={(e: Event) =>
                patch({buttonBorderWidth: numberValue(e)})
              }
            />
          </ResponsiveGrid>
          <s-number-field
            label="Button border radius"
            value={form.buttonBorderRadius}
            min={0}
            max={40}
            step={1}
            suffix="px"
            inputMode="numeric"
            onInput={(e: Event) =>
              patch({buttonBorderRadius: numberValue(e)})
            }
          />
        </s-stack>
      </s-section>
        </>
      ) : null}

      {selectedTab === 2 ? (
        <>
      <s-section heading="Discount upsell">
        <s-stack gap="base">
          <s-checkbox
            label="Enable Discount Upsell"
            checked={form.discountEnabled}
            onChange={(e: Event) =>
              patch({discountEnabled: checkedValue(e)})
            }
          />
          {form.discountEnabled ? (
            <>
              <s-number-field
                label="Unlock when cart reaches"
                details={thresholdDetails(form.discountThreshold)}
                value={form.discountThreshold}
                min={0}
                step={0.01}
                inputMode="decimal"
                onInput={(e: Event) =>
                  patch({discountThreshold: numberValue(e)})
                }
              />
              <s-text-field
                label="Discount label"
                value={form.discountLabel}
                onInput={(e: Event) =>
                  patch({discountLabel: fieldValue(e)})
                }
              />
              <s-text-field
                label="Message template"
                details="Use {remaining} and {discount} placeholders."
                value={form.discountMessage}
                onInput={(e: Event) =>
                  patch({discountMessage: fieldValue(e)})
                }
              />
              <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
                <s-color-field
                  label="Discount background"
                  value={form.discountBg}
                  onChange={(e: Event) =>
                    patch({discountBg: fieldValue(e)})
                  }
                />
                <s-color-field
                  label="Discount text"
                  value={form.discountTextColor}
                  onChange={(e: Event) =>
                    patch({discountTextColor: fieldValue(e)})
                  }
                />
              </ResponsiveGrid>
            </>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Free shipping bar">
        <s-stack gap="base">
          <s-checkbox
            label="Enable Free Shipping Bar"
            checked={form.shippingEnabled}
            onChange={(e: Event) =>
              patch({shippingEnabled: checkedValue(e)})
            }
          />
          {form.shippingEnabled ? (
            <>
              <s-number-field
                label="Unlock free shipping at"
                details={thresholdDetails(form.shippingThreshold)}
                value={form.shippingThreshold}
                min={0}
                step={0.01}
                inputMode="decimal"
                onInput={(e: Event) =>
                  patch({shippingThreshold: numberValue(e)})
                }
              />
              <s-text-field
                label="Progress message"
                details="Use {remaining} placeholder."
                value={form.shippingProgressMessage}
                onInput={(e: Event) =>
                  patch({shippingProgressMessage: fieldValue(e)})
                }
              />
              <s-text-field
                label="Unlocked message"
                value={form.shippingUnlockedMessage}
                onInput={(e: Event) =>
                  patch({shippingUnlockedMessage: fieldValue(e)})
                }
              />
              <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
                <s-color-field
                  label="Shipping background"
                  value={form.shippingBg}
                  onChange={(e: Event) =>
                    patch({shippingBg: fieldValue(e)})
                  }
                />
                <s-color-field
                  label="Shipping progress fill"
                  value={form.shippingFill}
                  onChange={(e: Event) =>
                    patch({shippingFill: fieldValue(e)})
                  }
                />
              </ResponsiveGrid>
            </>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Bundle offers">
        <s-stack gap="base">
          <s-checkbox
            label="Enable Bundle Offers"
            checked={form.bundleEnabled}
            onChange={(e: Event) =>
              patch({bundleEnabled: checkedValue(e)})
            }
          />
          {form.bundleEnabled ? (
            <>
              <s-text-field
                label="Bundle title"
                value={form.bundleTitle}
                onInput={(e: Event) =>
                  patch({bundleTitle: fieldValue(e)})
                }
              />
              <s-text-field
                label="Bundle subtitle"
                value={form.bundleSubtitle}
                onInput={(e: Event) =>
                  patch({bundleSubtitle: fieldValue(e)})
                }
              />
              <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
                <s-color-field
                  label="Bundle background"
                  value={form.bundleBg}
                  onChange={(e: Event) => patch({bundleBg: fieldValue(e)})}
                />
                <s-color-field
                  label="Bundle text"
                  value={form.bundleTextColor}
                  onChange={(e: Event) =>
                    patch({bundleTextColor: fieldValue(e)})
                  }
                />
              </ResponsiveGrid>
              <s-text>Bundle products</s-text>
              <s-button
                onClick={() =>
                  pickProducts(
                    form.bundleProducts,
                    (items) => patch({bundleProducts: items.slice(0, 1)}),
                    false,
                  )
                }
              >
                Browse products
              </s-button>
              <SelectedList
                items={form.bundleProducts}
                onRemove={(id) =>
                  patch({
                    bundleProducts: form.bundleProducts.filter(
                      (p) => p.id !== id,
                    ),
                  })
                }
              />
            </>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Timer">
        <s-stack gap="base">
          <s-checkbox
            label="Enable Timer"
            checked={form.timerEnabled}
            onChange={(e: Event) =>
              patch({timerEnabled: checkedValue(e)})
            }
          />
          {form.timerEnabled ? (
            <>
              <s-text-field
                label="Timer message"
                details="Use {timer} to insert the countdown"
                value={form.timerMessage}
                onInput={(e: Event) =>
                  patch({timerMessage: fieldValue(e)})
                }
              />

              <s-stack gap="small-200">
                <s-text>Countdown date and time</s-text>
                <input
                  type="datetime-local"
                  value={toDatetimeLocalValue(form.timerCountdownDate)}
                  onChange={(e) =>
                    patch({timerCountdownDate: e.currentTarget.value})
                  }
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #c9cccf',
                    background: '#f7f7f7',
                    fontSize: 14,
                    color: '#202223',
                  }}
                />
                <s-paragraph color="subdued">
                  Select the end date and time for the timer.
                </s-paragraph>
              </s-stack>

              <s-text>Timer labels (d/h/m/s)</s-text>
              <ResponsiveGrid gridTemplateColumns={COLS_TIMER_LABELS} gap="base">
                <s-text-field
                  label="Days"
                  value={form.timerLabelD}
                  onInput={(e: Event) =>
                    patch({timerLabelD: fieldValue(e)})
                  }
                />
                <s-text-field
                  label="Hours"
                  value={form.timerLabelH}
                  onInput={(e: Event) =>
                    patch({timerLabelH: fieldValue(e)})
                  }
                />
                <s-text-field
                  label="Minutes"
                  value={form.timerLabelM}
                  onInput={(e: Event) =>
                    patch({timerLabelM: fieldValue(e)})
                  }
                />
                <s-text-field
                  label="Seconds"
                  value={form.timerLabelS}
                  onInput={(e: Event) =>
                    patch({timerLabelS: fieldValue(e)})
                  }
                />
              </ResponsiveGrid>

              <s-choice-list
                label="After timer ends"
                name="timer-after-ends"
                values={[form.timerAfterEnds]}
                onChange={(e: Event) => {
                  const values = choiceValues(e);
                  if (values[0]) patch({timerAfterEnds: values[0]});
                }}
              >
                <s-choice value="hide">Hide</s-choice>
                <s-choice value="repeat">Repeat</s-choice>
                <s-choice value="show_message">Show message</s-choice>
              </s-choice-list>

              {form.timerAfterEnds === 'show_message' ? (
                <s-text-field
                  label="End message"
                  value={form.timerEndMessage}
                  onInput={(e: Event) =>
                    patch({timerEndMessage: fieldValue(e)})
                  }
                />
              ) : null}

              <ResponsiveGrid gridTemplateColumns={COLS_2} gap="base">
                <s-color-field
                  label="Timer background"
                  value={form.timerBg}
                  onChange={(e: Event) => patch({timerBg: fieldValue(e)})}
                />
                <s-color-field
                  label="Timer text"
                  value={form.timerTextColor}
                  onChange={(e: Event) =>
                    patch({timerTextColor: fieldValue(e)})
                  }
                />
              </ResponsiveGrid>

              <s-text>Timer products</s-text>
              <s-button onClick={pickTimerProducts}>Browse products</s-button>

              {form.timerProducts.length > 0 ? (
                <s-stack gap="small">
                  {form.timerProducts.map((product) => (
                    <s-box
                      key={product.variantId}
                      padding="base"
                      border="base"
                      borderRadius="base"
                    >
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
                          {product.imageUrl ? (
                            <s-thumbnail
                              src={product.imageUrl}
                              alt={product.title}
                              size="small"
                            />
                          ) : null}
                          <s-stack gap="small-200">
                            <s-text>{product.title}</s-text>
                            <s-number-field
                              label="Timer price (Rs.)"
                              value={product.timerPrice}
                              min={0}
                              step={0.01}
                              inputMode="decimal"
                              onInput={(e: Event) => {
                                const value = numberValue(e);
                                patch({
                                  timerProducts: form.timerProducts.map((p) =>
                                    p.variantId === product.variantId
                                      ? {...p, timerPrice: value}
                                      : p,
                                  ),
                                });
                              }}
                            />
                          </s-stack>
                        </s-stack>
                        <s-button
                          tone="critical"
                          variant="tertiary"
                          icon="delete"
                          accessibilityLabel={`Remove ${product.title}`}
                          onClick={() =>
                            patch({
                              timerProducts: form.timerProducts.filter(
                                (p) => p.variantId !== product.variantId,
                              ),
                            })
                          }
                        />
                      </s-stack>
                    </s-box>
                  ))}
                </s-stack>
              ) : null}
            </>
          ) : null}
        </s-stack>
      </s-section>
        </>
      ) : null}
    </s-page>
  );
}
