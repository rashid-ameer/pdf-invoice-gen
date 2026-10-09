export type UpsellConfig = Record<string, unknown>;

export function defaultUpsellConfig(): UpsellConfig {
  return {
    app_enabled: true,
    global_styles: {
      widget_background: '#ffffff',
      widget_padding: '32',
      title_color: '#1a1a1a',
      title_font_size: '24',
      title_alignment: 'center',
      price_color: '#333333',
      compare_price_color: '#999999',
      card_background: '#f9f9f9',
      card_border_radius: '12',
      card_border_color: '#e5e5e5',
      card_hover_shadow: true,
      button_background: '#000000',
      button_text_color: '#ffffff',
      button_border_radius: '8',
      button_text: 'Add to Cart',
      image_border_radius: '8',
      image_aspect_ratio: '1/1',
      product_title_color: '#1a1a1a',
      product_title_font_size: '14',
      spacing_between_cards: '16',
      custom_css: '',
    },
    placement_settings: {
      product_page: {
        enabled: true,
        position: 'below_add_to_cart',
        inject_method: 'theme_block',
      },
      cart_page: {
        enabled: true,
        position: 'below_cart_items_above_checkout',
        inject_method: 'theme_block',
      },
      cart_drawer: {
        enabled: false,
        position: 'below_drawer_items',
        inject_method: 'app_embed',
      },
    },
    features: {
      discount_upsell: {
        enabled: false,
        rules: [
          {
            id: 'discount_rule_1',
            enabled: true,
            threshold_amount: 5000,
            discount_label: '10% OFF',
            message_template: 'Add {remaining} more -> get {discount}',
            placement: {
              page: 'cart_page',
              position: 'below_cart_items_above_checkout',
            },
          },
        ],
        styles: {
          background_color: '#fff7ed',
          text_color: '#7c2d12',
          accent_color: '#ea580c',
          border_color: '#fed7aa',
          border_radius: '10',
          padding: '12',
        },
      },
      free_shipping_bar: {
        enabled: false,
        rules: [],
        styles: {},
      },
      bundle_offers: {
        enabled: false,
        rules: [],
        styles: {},
      },
      timer: {
        enabled: false,
        message: 'This price expires in {timer}',
        timer_type: 'countdown_to_date',
        countdown_date: '',
        labels: {d: 'd', h: 'h', m: 'm', s: 's'},
        after_timer_ends: 'show_message',
        end_message: 'This offer has expired',
        products: [],
        styles: {
          background_color: '#1a1a1a',
          text_color: '#ffffff',
          padding: '12',
        },
      },
    },
    rules: [
      {
        id: 'rule_1',
        name: 'Upsell Rule',
        enabled: true,
        priority: 1,
        trigger: {
          type: 'all_products',
          product_ids: [],
          collection_ids: [],
        },
        offer: {
          type: 'automated_recommendations',
          product_ids: [],
          recommendation_type: 'related',
          max_products: 4,
          only_in_stock: true,
          hide_already_in_cart: false,
        },
        display: {
          title: 'You may also like',
          layout: 'carousel',
          show_price: true,
          show_compare_price: true,
          show_add_to_cart_button: true,
        },
        placement: {
          product_page: {
            enabled: true,
            position: 'below_add_to_cart',
          },
          cart_page: {
            enabled: true,
            position: 'below_cart_items_above_checkout',
          },
          cart_drawer: {
            enabled: false,
            position: 'below_drawer_items',
          },
        },
      },
    ],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {...base};
  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(out[key]) && isPlainObject(value)) {
      out[key] = deepMerge(
        out[key] as Record<string, unknown>,
        value,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Merge incoming JSON onto defaults; keep flexible Record shape. */
export function normalizeUpsellConfig(raw: unknown): UpsellConfig {
  const incoming = isPlainObject(raw) ? raw : {};
  return deepMerge(defaultUpsellConfig(), incoming);
}
