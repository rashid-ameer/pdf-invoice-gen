(function () {
  function createWidgetElement(page, config, productData) {
    const root = document.createElement("div");
    root.className = "genie-upsell-widget";
    root.dataset.page = page;
    root.dataset.config = JSON.stringify(config || {});
    root.style.display = "none";

    if (page === "product_page" && productData) {
      root.dataset.productId = productData.id || "";
      root.dataset.productCollections = productData.collections || "";
    }

    root.innerHTML = `
      <style class="genie-upsell-dynamic-style"></style>
      <div class="genie-upsell-header">
        <h2 class="genie-upsell-title"></h2>
        <div class="genie-upsell-nav">
          <button type="button" class="genie-upsell-prev" aria-label="Previous">&lsaquo;</button>
          <button type="button" class="genie-upsell-next" aria-label="Next">&rsaquo;</button>
        </div>
      </div>
      <div class="genie-upsell-grid"></div>
    `;
    return root;
  }

  const LOG_PREFIX = "[InvoiceUpsell]";

  function debugLog(message, data) {
    if (typeof data !== "undefined") {
      console.log(`${LOG_PREFIX} ${message}`, data);
    } else {
      console.log(`${LOG_PREFIX} ${message}`);
    }
  }

  function parseJSON(value) {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return null;
    }
  }

  function normalizeId(id) {
    if (id == null) return "";
    const value = String(id);
    return value.includes("/") ? value.split("/").pop() : value;
  }

  function money(cents) {
    if (window.Shopify && window.Shopify.formatMoney) {
      try { return window.Shopify.formatMoney(cents); } catch (_e) {}
    }
    return (Number(cents || 0) / 100).toFixed(2);
  }

  // ─── Cart helpers (mirrors genie-wishlist.js approach) ───────────────────────

  function replaceSectionHTML(sid, html) {
    if (!html) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const next = doc.getElementById("shopify-section-" + sid) || doc.getElementById(sid) || doc.querySelector('[id*="' + sid + '"]');
    const curr = document.getElementById("shopify-section-" + sid) || document.getElementById(sid) || document.querySelector('[id*="' + sid + '"]');
    if (next && curr) curr.innerHTML = next.innerHTML;
  }

  function updateCartCount(n) {
    document.querySelectorAll('[class*="cart-count"], [class*="cart__count"], [data-cart-count], .cart-count-bubble span').forEach((el) => {
      el.textContent = n;
    });
  }

  function removeEmptyState(el) {
    Array.from(el.classList).forEach((cls) => {
      if (cls.indexOf("empty") !== -1) el.classList.remove(cls);
    });
  }

  function openThemeCart(resp) {
    const drawer = document.querySelector("cart-drawer");
    if (drawer) {
      removeEmptyState(drawer);
      if (typeof drawer.renderContents === "function" && resp) {
        try { drawer.renderContents(resp); return; } catch (_e) {}
      }
      fetch(window.location.pathname + "?sections=cart-drawer")
        .then((r) => r.json())
        .then((sections) => {
          if (sections["cart-drawer"]) replaceSectionHTML("cart-drawer", sections["cart-drawer"]);
        })
        .catch(() => {})
        .finally(() => {
          setTimeout(() => {
            const d = document.querySelector("cart-drawer");
            if (!d) return;
            removeEmptyState(d);
            if (typeof d.open === "function") d.open();
            else d.setAttribute("open", "");
          }, 80);
        });
      return;
    }
    const notif = document.querySelector("cart-notification");
    if (notif && typeof notif.renderContents === "function" && resp) {
      try { notif.renderContents(resp); return; } catch (_e) {}
    }
    document.dispatchEvent(new CustomEvent("cart:open", { bubbles: true }));
    document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
    const trigger = document.querySelector('[data-cart-toggle], details[id*="cart"] > summary, a[href="/cart"]');
    if (trigger) trigger.click();
  }

  async function addToCartAndOpen(variantId) {
    const bubbleSections = ["cart-icon-bubble", "cart-notification-product", "cart-notification-button", "cart-live-region-text"];
    const allSections = ["cart-drawer"].concat(bubbleSections);
    const res = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(variantId), quantity: 1, sections: allSections.join(","), sections_url: window.location.pathname })
    });
    if (!res.ok) throw new Error("Add to cart failed");
    const resp = await res.json();
    if (resp.sections) {
      bubbleSections.forEach((sid) => replaceSectionHTML(sid, resp.sections[sid]));
    }
    try {
      const cart = await fetch("/cart.js").then((r) => r.json());
      updateCartCount(cart.item_count);
      document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true, detail: cart }));
    } catch (_e) {}
    openThemeCart(resp);
    return resp;
  }

  // ─────────────────────────────────────────────────────────────────────────────

  async function fetchCart() {
    try {
      const res = await fetch("/cart.js");
      return await res.json();
    } catch (_e) {
      return { items: [] };
    }
  }

  function getProxyBase() {
    var embed = document.getElementById("invoice-feature-embed");
    var base = embed && embed.getAttribute("data-proxy-base");
    return String(base || "/apps/pdf-invoice").trim().replace(/\/$/, "");
  }

  function mapProxyProducts(fromProxy) {
    return fromProxy.map((p) => ({
      id: String(p.id),
      title: p.title,
      url: p.url,
      price: p.price,
      compare_at_price: p.compare_at_price,
      available: p.available !== false,
      featured_image: p.featured_image,
      variants: (p.variants || []).map((v) => ({
        id: normalizeId(v.id),
        price: v.price,
      })),
    }));
  }

  async function fetchSpecificProducts(gids) {
    const ids = gids.map(normalizeId).filter(Boolean);
    if (!ids.length) return [];

    // Prefer app proxy (Admin GraphQL) — storefront suggest.json?q=id:… often returns nothing.
    // Fall back to absolute app URL with shopify_domain (same pattern as wishlist/badges).
    try {
      const idsParam = encodeURIComponent(ids.join(","));
      const proxyUrl = getProxyBase() + "/upsell-products?ids=" + idsParam;
      let fromProxy = [];
      try {
        const proxyRes = await fetch(proxyUrl, {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!proxyRes.ok) throw new Error("bad proxy response");
        const proxyData = await proxyRes.json();
        fromProxy = Array.isArray(proxyData?.products) ? proxyData.products : [];
      } catch (proxyErr) {
        debugLog("fetchSpecificProducts proxy failed", proxyErr);
        var embed = document.getElementById("invoice-feature-embed");
        var domainEl = document.getElementById("invoice-extras-domain");
        var appBase = String(
          (embed && embed.getAttribute("data-app-url")) ||
            (domainEl && domainEl.getAttribute("data-app-url")) ||
            "",
        )
          .trim()
          .replace(/\/$/, "");
        var domain =
          (domainEl && domainEl.getAttribute("data-store-domain")) || "";
        if (appBase && domain) {
          var absoluteUrl =
            appBase +
            "/api/storefront/upsell-products?ids=" +
            idsParam +
            "&shopify_domain=" +
            encodeURIComponent(domain);
          const absRes = await fetch(absoluteUrl, {
            method: "GET",
            credentials: "omit",
            headers: { Accept: "application/json" },
          });
          if (absRes.ok) {
            const absData = await absRes.json();
            fromProxy = Array.isArray(absData?.products) ? absData.products : [];
          }
        }
      }
      if (fromProxy.length) {
        debugLog("fetchSpecificProducts via proxy", {
          requested: ids,
          found: fromProxy.map((p) => p.id),
        });
        return mapProxyProducts(fromProxy);
      }
    } catch (e) {
      debugLog("fetchSpecificProducts proxy failed", e);
    }

    const products = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      try {
        const suggest = await fetch(
          `/search/suggest.json?q=${encodeURIComponent("id:" + id)}&resources[type]=product&resources[limit]=1`,
        ).then((r) => r.json());
        const found = suggest?.resources?.results?.products?.[0];
        if (!found?.handle) continue;
        const productJson = await fetch(`/products/${found.handle}.js`).then(
          (r) => r.json(),
        );
        products.push({
          id: String(productJson.id),
          title: productJson.title,
          url: `/products/${found.handle}`,
          price: productJson.price,
          compare_at_price: productJson.compare_at_price,
          available: productJson.available,
          featured_image: productJson.featured_image,
          variants: productJson.variants || [],
        });
      } catch (_e) {}
    }
    debugLog("fetchSpecificProducts via suggest", {
      requested: ids,
      found: products.map((p) => p.id),
    });
    return products;
  }

  async function fetchAutomatedRecommendations(productId, rule) {
    const intent = rule.offer?.recommendation_type === "complementary" ? "complementary" : "related";
    const limit = (rule.offer?.max_products || 4) + 4;
    try {
      const url = `/recommendations/products.json?product_id=${productId}&limit=${limit}&intent=${intent}`;
      debugLog("Recommendations request", { productId: String(productId), intent, limit, url });
      const data = await fetch(url).then((r) => r.json());
      debugLog("Recommendations raw response", data);
      debugLog("Recommendations products returned", (data.products || []).map((p) => ({
        id: String(p.id),
        title: p.title,
        available: p.available,
        price: p.price,
      })));
      return (data.products || []).map((p) => ({
        id: String(p.id),
        title: p.title,
        url: p.url,
        price: p.price,
        compare_at_price: p.compare_at_price,
        available: p.available,
        featured_image: p.featured_image,
        variants: p.variants || [],
      }));
    } catch (e) {
      debugLog("Recommendations fetch failed", e);
      return [];
    }
  }

  function applyScopedStyles(root, styles) {
    const id = root.id || `genie-upsell-${Math.random().toString(36).slice(2)}`;
    root.id = id;
    const styleTag = root.querySelector(".genie-upsell-dynamic-style");
    if (!styleTag) return;
    styleTag.textContent = `
      #${id} { background: ${styles.widget_background || "transparent"}; padding: ${styles.widget_padding || 24}px; }
      #${id} .genie-upsell-title { color: ${styles.title_color || "#1a1a1a"}; font-size: ${styles.title_font_size || 16}px; font-weight: 600; text-align: ${styles.title_alignment || "left"}; margin: 0 0 12px; }
      #${id} .genie-upsell-grid { display: grid; grid-template-columns: 1fr; gap: ${styles.spacing_between_cards || 16}px; }
      #${id} .genie-upsell-grid.carousel { display: flex; flex-direction: row; overflow-x: auto; scroll-snap-type: x mandatory; -ms-overflow-style: none; scrollbar-width: none; gap: ${styles.spacing_between_cards || 16}px; }
      #${id} .genie-upsell-grid.carousel::-webkit-scrollbar { display: none; }
      #${id} .genie-upsell-card { background: ${styles.card_background || "#fff"}; border-radius: ${styles.card_border_radius || 12}px; border: 1px solid ${styles.card_border_color || "#e5e5e5"}; overflow: hidden; }
      #${id} .genie-upsell-grid.carousel .genie-upsell-card { min-width: 280px; max-width: 320px; flex-shrink: 0; scroll-snap-align: start; }
      #${id} .genie-upsell-card-inner { display: flex; align-items: center; gap: 10px; padding: 8px; }
      #${id} .genie-upsell-img-link { flex-shrink: 0; display: block; }
      #${id} .genie-upsell-image { width: 64px; height: 64px; object-fit: cover; border-radius: ${styles.image_border_radius || 8}px; display: block; }
      #${id} .genie-upsell-image-placeholder { width: 64px; height: 64px; background: #d7d7d7; border-radius: ${styles.image_border_radius || 8}px; }
      #${id} .genie-upsell-info { flex: 1; min-width: 0; }
      #${id} .genie-upsell-title-text { color: ${styles.product_title_color || "#1a1a1a"}; font-size: ${styles.product_title_font_size || 14}px; margin: 0 0 4px; line-height: 1.3; font-weight: 500; overflow: hidden; text-overflow: ellipsis;}
      #${id} .genie-upsell-price { color: ${styles.price_color || "#333"}; margin: 0; font-weight: 600; font-size: 13px; }
      #${id} .genie-upsell-compare { color: ${styles.compare_price_color || "#999"}; text-decoration: line-through; margin-left: 6px; font-weight: 400; }
      #${id} .genie-upsell-button { flex-shrink: 0; border-style: solid; border-color: ${styles.card_border_color || "#e5e5e5"}; border-width: 1px; border-radius: ${styles.button_border_radius || 8}px; background: ${styles.button_background || "#000"}; color: ${styles.button_text_color || "#fff"}; padding: 8px 14px; font-weight: 700; cursor: pointer; font-size: 13px; }
      #${id}[data-page="cart_drawer"] .genie-upsell-grid.carousel { max-width: 335px; }
      #${id}[data-page="cart_page"] .genie-upsell-grid.carousel { max-width: 100%; }
      ${styles.card_hover_shadow ? `#${id} .genie-upsell-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12); transition: box-shadow 0.2s; }` : ""}
      ${styles.custom_css || ""}
    `;
  }

  function findRuleForProduct(config, productId, collectionIds) {
    const rules = (config.rules || []).filter((r) => r.enabled !== false).sort((a, b) => (a.priority || 1) - (b.priority || 1));
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      if (rule.placement?.product_page?.enabled === false) continue;
      const triggerType = rule.trigger?.type || "all_products";
      if (triggerType === "all_products") return rule;
      if (triggerType === "specific_products") {
        const ids = (rule.trigger.product_ids || []).map(normalizeId);
        if (ids.includes(normalizeId(productId))) return rule;
      }
      if (triggerType === "specific_collections") {
        const ids = (rule.trigger.collection_ids || []).map(normalizeId);
        if ((collectionIds || []).some((cid) => ids.includes(normalizeId(cid)))) return rule;
      }
    }
    return null;
  }

  function findRuleForContext(config, page) {
    const rules = (config.rules || []).filter((r) => r.enabled !== false).sort((a, b) => (a.priority || 1) - (b.priority || 1));
    return rules.find((r) => r.placement?.[page]?.enabled !== false) || null;
  }

  function insertAfter(target, node) {
    if (!target || !target.parentNode) return false;
    target.parentNode.insertBefore(node, target.nextSibling);
    return true;
  }

  function injectProductWidget(root, position) {
    const positionMap = {
      below_add_to_cart: [
        ".shopify-payment-button",
        ".product-form__buttons",
        "form[action='/cart/add']",
        "product-form",
        ".product-form",
        "[data-product-form]",
      ],
      below_description: [
        ".product__description",
        ".product-single__description",
        "[data-product-description]",
        ".product__content",
      ],
      below_reviews: [
        "#shopify-product-reviews",
        ".spr-container",
        "#judgeme_product_reviews",
        "[data-reviews]",
        ".product-reviews",
      ],
    };

    const selectors = positionMap[position] || positionMap.below_add_to_cart;
    for (let i = 0; i < selectors.length; i += 1) {
      const target = document.querySelector(selectors[i]);
      if (!target) continue;

      // Prefer inserting below the entire product button wrapper when buy-now exists
      if (position === "below_add_to_cart") {
        const buyNow = document.querySelector(".shopify-payment-button");
        if (buyNow) {
          const wrapper = buyNow.closest(".product-form__buttons")
            || buyNow.closest("product-form")
            || buyNow.closest("form")
            || buyNow.parentElement;
          if (wrapper && insertAfter(wrapper, root)) return true;
        }
      }

      if (insertAfter(target, root)) return true;
    }

    return false;
  }

  function injectCartPageWidget(root, position) {
    const positionMap = {
      above_cart_items: [
        ".cart__items",
        ".cart-items",
        "[data-cart-items]",
        "form[action='/cart'] table",
        "form[action='/cart'] ul",
      ],
      below_cart_items_above_checkout: [
        ".cart__footer",
        ".cart-footer",
        "[data-cart-footer]",
        ".cart__ctas",
        ".cart__checkout-button",
        "[data-cart-checkout]",
      ],
      below_checkout: [
        ".cart__checkout-button",
        "[data-cart-checkout]",
        ".cart__checkout",
      ],
    };

    if (position === "above_cart_items") {
      const selectors = positionMap.above_cart_items;
      for (let i = 0; i < selectors.length; i += 1) {
        const target = document.querySelector(selectors[i]);
        if (target && target.parentNode) {
          target.parentNode.insertBefore(root, target);
          return true;
        }
      }
    }

    const selectors = positionMap[position] || positionMap.below_cart_items_above_checkout;
    for (let i = 0; i < selectors.length; i += 1) {
      if (insertAfter(document.querySelector(selectors[i]), root)) return true;
    }

    const cartForm = document.querySelector("form[action='/cart']");
    if (cartForm) { cartForm.appendChild(root); return true; }
    return false;
  }

  function injectCartDrawerWidget(root, position) {
    // Selectors for the scrollable items container (above footer)
    const itemsSelectors = [
      "#CartDrawer-CartItems",
      ".cart-drawer__items",
      "[data-cart-drawer-items]",
      ".cart-drawer__scrollable",
    ];
    // Selectors for the footer (used as insertBefore target)
    const footerSelectors = [
      "#CartDrawer-Footer",
      ".cart-drawer__footer",
      ".drawer__footer",
      "[data-cart-drawer-footer]",
    ];
    const subtotalSelectors = [
      "#CartDrawer-Footer .totals",
      ".cart-drawer__subtotal",
      ".cart__subtotal",
      "[data-subtotal]",
    ];

    if (position === "above_subtotal") {
      for (let i = 0; i < subtotalSelectors.length; i += 1) {
        const target = document.querySelector(subtotalSelectors[i]);
        if (target && target.parentNode) {
          target.parentNode.insertBefore(root, target);
          return true;
        }
      }
    }

    // below_drawer_items: insert after the items container (between items and footer)
    for (let i = 0; i < itemsSelectors.length; i += 1) {
      if (insertAfter(document.querySelector(itemsSelectors[i]), root)) return true;
    }
    // Fallback: insert before the footer
    for (let i = 0; i < footerSelectors.length; i += 1) {
      const target = document.querySelector(footerSelectors[i]);
      if (target && target.parentNode) {
        target.parentNode.insertBefore(root, target);
        return true;
      }
    }

    const drawer = document.querySelector("cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer]");
    if (drawer) { drawer.appendChild(root); return true; }
    return false;
  }

  function createFeatureRoot(className) {
    const el = document.createElement("div");
    el.className = className;
    return el;
  }

  function injectFeatureByPlacement(root, placement, fallbackPage) {
    const page = placement?.page || fallbackPage;
    const position = placement?.position;
    if (page === "product_page") return injectProductWidget(root, position || "below_add_to_cart");
    if (page === "cart_drawer") return injectCartDrawerWidget(root, position || "below_drawer_items");
    return injectCartPageWidget(root, position || "below_cart_items_above_checkout");
  }

  function findNonDrawerNode(selectors, scope) {
    for (let i = 0; i < selectors.length; i += 1) {
      const candidate = (scope || document).querySelector(selectors[i]);
      if (!candidate) continue;
      const inDrawer = candidate.closest("cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer]");
      if (!inDrawer) return candidate;
    }
    return null;
  }

  function injectDiscountNearCheckout(root) {
    const cartBlocks = findNonDrawerNode([".cart__blocks"], document);
    const cartCtas = findNonDrawerNode([".cart__blocks > .cart__ctas", ".cart__ctas"], cartBlocks || document);
    if (cartBlocks && cartCtas && cartCtas.parentNode === cartBlocks) {
      cartBlocks.insertBefore(root, cartCtas);
      return true;
    }

    const blocksContentSelectors = [
      ".cart__blocks > .js-contents",
      ".cart__blocks .js-contents",
    ];
    const totalsSelectors = [
      ".cart__footer .totals",
      ".cart-footer .totals",
      "[data-cart-footer] .totals",
      ".cart__subtotal",
      "[data-subtotal]",
      ".totals"
    ];
    const checkoutSelectors = [
      ".cart__ctas",
      ".cart__checkout-button",
      "[data-cart-checkout]",
      ".cart__checkout",
      "button[name='checkout']",
      "form[action='/cart'] [type='submit']"
    ];

    const cartForm = document.querySelector("form[action='/cart']");
    const blocksContentNode = findNonDrawerNode(blocksContentSelectors, cartForm || document);
    if (blocksContentNode && insertAfter(blocksContentNode, root)) {
      return true;
    }

    const totalsNode = findNonDrawerNode(totalsSelectors, cartForm || document);
    if (totalsNode && insertAfter(totalsNode, root)) {
      return true;
    }

    const checkoutNode = findNonDrawerNode(checkoutSelectors, cartForm || document);
    if (checkoutNode && checkoutNode.parentNode) {
      checkoutNode.parentNode.insertBefore(root, checkoutNode);
      return true;
    }

    // Fallback to cart page strategy (still non-drawer by selector set)
    return injectCartPageWidget(root, "below_cart_items_above_checkout");
  }

  function injectFeatureIntoCartDrawer(root) {
    const drawer = document.querySelector(
      "cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer]",
    );
    if (!drawer) return false;

    const checkout = drawer.querySelector(
      ".cart__ctas, .cart-drawer__checkout, button[name='checkout'], [name='checkout'], .cart__checkout-button",
    );
    if (checkout && checkout.parentNode) {
      checkout.parentNode.insertBefore(root, checkout);
      return true;
    }

    const footer = drawer.querySelector(
      ".cart-drawer__footer, .drawer__footer, .cart__footer, .cart-drawer__footer-wrapper",
    );
    if (footer) {
      footer.insertBefore(root, footer.firstChild);
      return true;
    }

    drawer.appendChild(root);
    return true;
  }

  function placeCartFeature(root, pageType) {
    if (pageType === "cart") {
      if (injectDiscountNearCheckout(root)) return "cart_page";
    }
    if (injectFeatureIntoCartDrawer(root)) return "cart_drawer";
    if (pageType === "cart" && injectDiscountNearCheckout(root)) return "cart_page";
    return null;
  }

  async function renderDiscountUpsell(config, pageType, cartData) {
    const feature = config?.features?.discount_upsell;
    if (!feature?.enabled) return;
    const rule = (feature.rules || []).find((r) => r.enabled !== false);
    if (!rule) return;
    const cart = cartData || await fetchCart();
    const subtotal = Number(cart?.total_price || 0);
    const threshold = Number(rule.threshold_amount || 0);
    const remaining = Math.max(0, threshold - subtotal);

    const styles = feature.styles || {};
    const baseMessage = (rule.message_template || "Add {remaining} more -> get {discount}")
      .replace("{remaining}", money(remaining))
      .replace("{discount}", rule.discount_label || "Discount");
    const message = remaining > 0 ? baseMessage : `You unlocked ${rule.discount_label || "discount"}`;

    document.querySelectorAll(".genie-discount-upsell").forEach((el) => el.remove());

    const root = createFeatureRoot("genie-discount-upsell");
    root.innerHTML = `
      <div class="genie-discount-inner">
        <p class="genie-discount-text"></p>
      </div>
    `;
    root.querySelector(".genie-discount-text").textContent = message;
    root.style.background = styles.background_color || "#fff7ed";
    root.style.color = styles.text_color || "#7c2d12";
    root.style.border = `1px solid ${styles.border_color || "#fed7aa"}`;
    root.style.borderRadius = `${styles.border_radius || 10}px`;
    root.style.padding = `${styles.padding || 12}px`;
    root.style.margin = "12px 0";

    const placed = placeCartFeature(root, pageType);
    debugLog("Discount upsell render", {
      pageType,
      placed,
      threshold,
      subtotal,
      remaining,
      message,
    });
    if (!placed) document.body.appendChild(root);
  }

  async function renderFreeShippingBar(config, pageType, cartData) {
    const feature = config?.features?.free_shipping_bar;
    if (!feature?.enabled) return;
    const rule = (feature.rules || []).find((r) => r.enabled !== false);
    if (!rule) return;
    const cart = cartData || await fetchCart();
    const subtotal = Number(cart?.total_price || 0);
    const threshold = Number(rule.threshold_amount || 0);
    if (threshold <= 0) return;
    const remaining = Math.max(0, threshold - subtotal);
    const progress = Math.min(100, Math.round((subtotal / threshold) * 100));
    const styles = feature.styles || {};

    document.querySelectorAll(".genie-shipping-bar").forEach((el) => el.remove());

    const root = createFeatureRoot("genie-shipping-bar");
    const message = remaining > 0
      ? (rule.progress_message || "Spend {remaining} more to unlock FREE shipping").replace("{remaining}", money(remaining))
      : (rule.unlocked_message || "You unlocked FREE shipping!");
    root.innerHTML = `
      <div class="genie-shipping-inner">
        <p class="genie-shipping-text">${message}</p>
        <div class="genie-shipping-progress"><span class="genie-shipping-progress-fill"></span></div>
      </div>
    `;
    const fill = root.querySelector(".genie-shipping-progress-fill");
    if (fill) fill.style.width = `${progress}%`;
    root.style.background = styles.background_color || "#ecfeff";
    root.style.color = styles.text_color || "#155e75";
    root.style.borderRadius = `${styles.border_radius || 10}px`;
    root.style.padding = `${styles.padding || 12}px`;
    root.style.margin = "12px 0";
    const progressTrack = root.querySelector(".genie-shipping-progress");
    if (progressTrack) progressTrack.style.background = styles.progress_bg_color || "#a5f3fc";
    if (fill) fill.style.background = styles.progress_fill_color || "#06b6d4";

    const placed = placeCartFeature(root, pageType);
    debugLog("Free shipping render", {
      pageType,
      placed,
      threshold,
      subtotal,
      remaining,
      progress,
    });
    if (!placed) document.body.appendChild(root);
  }

  async function renderBundleOffers(config, pageType) {
    if (pageType !== "product") return;
    const feature = config?.features?.bundle_offers;
    if (!feature?.enabled) return;
    const rule = (feature.rules || []).find((r) => r.enabled !== false);
    if (!rule) return;
    const styles = feature.styles || {};
    const productIds = (rule.product_ids || []).map(normalizeId).filter(Boolean);
    const bundleProducts = productIds.length ? await fetchSpecificProducts(productIds) : [];
    const root = createFeatureRoot("genie-bundle-offer");
    const productCardsHtml = bundleProducts.map((p) => `
      <div class="genie-bundle-product">
        ${p.featured_image
          ? `<img class="genie-bundle-product-img" src="${p.featured_image}" alt="${p.title}">`
          : `<div class="genie-bundle-product-img genie-bundle-product-img--placeholder"></div>`}
        <p class="genie-bundle-product-title">${p.title}</p>
        ${p.price ? `<p class="genie-bundle-product-price">${money(p.price)}</p>` : ""}
      </div>
    `).join(`<div class="genie-bundle-plus">+</div>`);
    const bundleProductsClass = bundleProducts.length === 1
      ? "genie-bundle-products genie-bundle-products--single"
      : "genie-bundle-products";
    root.innerHTML = `
      <div class="genie-bundle-inner">
        <p class="genie-bundle-title">${rule.title || "Combo deal"}</p>
        <p class="genie-bundle-subtitle">${rule.subtitle || "Buy 2 get 1 free"}</p>
        ${bundleProducts.length ? `<div class="${bundleProductsClass}">${productCardsHtml}</div>` : ""}
        <button type="button" class="genie-bundle-button"${!bundleProducts.length ? " disabled" : ""}>Add bundle</button>
      </div>
    `;
    root.style.background = styles.background_color || "#f5f3ff";
    root.style.color = styles.text_color || "#4c1d95";
    root.style.borderRadius = `${styles.border_radius || 10}px`;
    root.style.padding = `${styles.padding || 12}px`;
    const btn = root.querySelector(".genie-bundle-button");
    if (btn) {
      btn.style.background = styles.button_background || "#6d28d9";
      btn.style.color = styles.button_text_color || "#ffffff";
      btn.addEventListener("click", async () => {
        if (!bundleProducts.length) return;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = "Adding...";
        try {
          // Add all bundle items; use addToCartAndOpen only on the last one so
          // the drawer opens once with the fully updated cart.
          for (let i = 0; i < bundleProducts.length - 1; i += 1) {
            const variantId = bundleProducts[i]?.variants?.[0]?.id;
            if (!variantId) continue;
            await fetch("/cart/add.js", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: Number(variantId), quantity: 1 })
            });
          }
          const lastVariantId = bundleProducts[bundleProducts.length - 1]?.variants?.[0]?.id;
          if (lastVariantId) await addToCartAndOpen(lastVariantId);
          btn.textContent = "Added!";
        } catch (_e) {
          btn.textContent = "Error";
        }
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 1200);
      });
    }
    const moved = injectFeatureByPlacement(root, rule.placement, "product_page");
    debugLog("Bundle offer render", { moved, product_count: bundleProducts.length });
    if (!moved) document.body.appendChild(root);
  }

  function renderTimer(config) {
    const feature = config?.features?.timer;
    if (!feature?.enabled || !feature?.countdown_date) return;

    const labels = feature.labels || { d: 'd', h: 'h', m: 'm', s: 's' };
    const afterEnds = feature.after_timer_ends || 'hide';
    const styles = feature.styles || {};

    const endTime = new Date(feature.countdown_date).getTime();

    const bar = document.createElement('div');
    bar.className = 'genie-timer-bar';
    bar.style.cssText = `background:${styles.background_color||'#1a1a1a'};color:${styles.text_color||'#fff'};padding:${styles.padding||12}px;text-align:center;font-size:14px;font-weight:600;width:100%;box-sizing:border-box;position:fixed;top:0;left:0;z-index:9999;`;
    const messageEl = document.createElement('span');
    bar.appendChild(messageEl);

    // Always add to top of page, not inside cart drawer
    document.body.prepend(bar);
    
    // Add padding to body so content isn't hidden behind fixed timer bar
    document.body.style.paddingTop = `${styles.padding || 12 * 2 + 20}px`;

    function formatTime(ms) {
      if (ms <= 0) return null;
      const t = Math.floor(ms / 1000);
      const d = Math.floor(t / 86400);
      const h = Math.floor((t % 86400) / 3600);
      const m = Math.floor((t % 3600) / 60);
      const s = t % 60;
      const parts = [];
      if (d > 0) parts.push(`${d}${labels.d}`);
      if (h > 0 || d > 0) parts.push(`${h}${labels.h}`);
      parts.push(`${String(m).padStart(2,'0')}${labels.m}`);
      parts.push(`${String(s).padStart(2,'0')}${labels.s}`);
      return parts.join(' ');
    }

    let interval;
    function tick() {
      const remaining = endTime - Date.now();
      const timeStr = formatTime(remaining);
      if (!timeStr) {
        clearInterval(interval);
        if (afterEnds === 'hide') { bar.remove(); return; }
        if (afterEnds === 'repeat') {
          endTime = Date.now() + (Number(feature.fixed_minutes || 10) * 60000);
          sessionStorage.setItem(STORAGE_KEY, String(endTime));
          interval = setInterval(tick, 1000);
          return;
        }
        messageEl.textContent = feature.end_message || 'This offer has expired';
        return;
      }
      messageEl.textContent = (feature.message || 'This price expires in {timer}').replace('{timer}', timeStr);
    }

    tick();
    interval = setInterval(tick, 1000);
    debugLog("Timer rendered successfully");
  }

  async function renderWidget(root) {
    debugLog("Widget bootstrapping", {
      page: root?.dataset?.page,
      hasConfigAttribute: !!root?.dataset?.config
    });

    const config = parseJSON(root.dataset.config);
    if (!config) {
      debugLog("Metafield config missing or invalid JSON");
      return;
    }

    debugLog("Metafield config loaded", {
      app_enabled: config.app_enabled,
      rules_count: (config.rules || []).length
    });

    if (config.app_enabled === false) {
      debugLog("App disabled in metafield, skipping render");
      return;
    }
    const styles = config.global_styles || {};
    applyScopedStyles(root, styles);

    const page = root.dataset.page;
    const grid = root.querySelector(".genie-upsell-grid");
    const titleNode = root.querySelector(".genie-upsell-title");
    const navNode = root.querySelector(".genie-upsell-nav");
    const currentProductId = normalizeId(root.dataset.productId);
    const collectionIds = (root.dataset.productCollections || "").split(",").filter(Boolean);

    let rule = null;
    let sourceProductId = currentProductId;
    let cartIds = [];

    if (page === "product_page") {
      rule = findRuleForProduct(config, currentProductId, collectionIds);
      debugLog("Product page rule matching", {
        current_product_id: currentProductId,
        collection_ids: collectionIds
      });
    } else {
      rule = findRuleForContext(config, page);
      const cart = await fetchCart();
      cartIds = (cart.items || []).map((i) => String(i.product_id));
      sourceProductId = String(cart.items?.[0]?.product_id || "");
      if (!sourceProductId) return;
    }

    if (!rule) {
      debugLog("No matching rule for page", { page });
      return;
    }

    if (page === "product_page" && !root.dataset.injected) {
      const preferredPosition = rule?.placement?.product_page?.position || "below_add_to_cart";
      const moved = injectProductWidget(root, preferredPosition);
      if (moved) root.dataset.injected = "1";
      debugLog("Product widget injection result", { preferredPosition, moved });
    }

    if (page === "cart_page" && !root.dataset.injected) {
      const preferredPosition = rule?.placement?.cart_page?.position || "below_cart_items_above_checkout";
      const moved = injectCartPageWidget(root, preferredPosition);
      if (moved) root.dataset.injected = "1";
      debugLog("Cart page widget injection result", { preferredPosition, moved });
    }

    if (page === "cart_drawer" && !root.dataset.injected) {
      const preferredPosition = rule?.placement?.cart_drawer?.position || "below_drawer_items";
      const moved = injectCartDrawerWidget(root, preferredPosition);
      if (moved) root.dataset.injected = "1";
      debugLog("Cart drawer widget injection result", { preferredPosition, moved });
    }

    debugLog("Matched rule", {
      page,
      rule_id: rule.id,
      trigger_type: rule?.trigger?.type,
      offer_type: rule?.offer?.type
    });

    const display = rule.display || {};
    const offer = rule.offer || {};
    const maxProducts = Number(offer.max_products || 4);
    const layout = display.layout === "grid" ? "grid" : "carousel";
    grid.classList.toggle("carousel", layout === "carousel");
    if (navNode) navNode.style.display = layout === "carousel" ? "flex" : "none";
    titleNode.textContent = display.title || "You may also like";

    let products = [];
    if (offer.type === "specific_products") {
      products = await fetchSpecificProducts(offer.product_ids || []);
    } else {
      products = await fetchAutomatedRecommendations(sourceProductId, rule);
    }

    debugLog("Products fetched before filters", {
      count: products.length,
      offer_type: offer.type
    });

    products = products.filter((p) => String(p.id) !== String(currentProductId));
    if (offer.only_in_stock) products = products.filter((p) => p.available !== false);
    if (offer.hide_already_in_cart && cartIds.length) {
      products = products.filter((p) => !cartIds.includes(String(p.id)));
    }
    products = products.slice(0, maxProducts);
    debugLog("Products after filters", {
      count: products.length,
      max_products: maxProducts,
      only_in_stock: !!offer.only_in_stock,
      hide_already_in_cart: !!offer.hide_already_in_cart
    });

    if (!products.length) {
      debugLog("No products to render after filters");
      return;
    }

    const timerFeature = config?.features?.timer;
    const timerProducts = timerFeature?.enabled ? (timerFeature.products || []) : [];
    debugLog("Timer feature status", { enabled: timerFeature?.enabled, products: timerProducts });
    
    const getTimerPrice = (variantId) => {
      const vid = String(variantId).split('/').pop();
      const timerProduct = timerProducts.find(tp => String(tp.variant_id).split('/').pop() === vid);
      debugLog("Checking timer price", { variantId: vid, found: !!timerProduct, timerPrice: timerProduct?.timer_price });
      return timerProduct ? timerProduct.timer_price : null;
    };

    grid.innerHTML = products.map((p) => {
      const variantId = p.variants?.[0]?.id;
      const timerPrice = variantId ? getTimerPrice(variantId) : null;
      const displayPrice = timerPrice ? timerPrice * 100 : p.price;
      const showComparePrice = timerPrice && p.price > displayPrice;
      const hasTimerPrice = !!timerPrice;
      
      return `
      <div class="genie-upsell-card">
        <div class="genie-upsell-card-inner">
          <a href="${p.url}" class="genie-upsell-img-link">
            ${p.featured_image ? `<img class="genie-upsell-image" src="${p.featured_image}" alt="${p.title}" loading="lazy">` : `<div class="genie-upsell-image-placeholder"></div>`}
          </a>
          <div class="genie-upsell-info">
            <p class="genie-upsell-title-text">${p.title}</p>
            ${display.show_price === false ? "" : `<p class="genie-upsell-price">${hasTimerPrice ? '⏰ ' : ''}${money(displayPrice)}${showComparePrice ? ` <span class="genie-upsell-compare">${money(p.price)}</span>` : display.show_compare_price !== false && p.compare_at_price && p.compare_at_price > p.price ? ` <span class="genie-upsell-compare">${money(p.compare_at_price)}</span>` : ""}</p>`}
          </div>
          ${display.show_add_to_cart_button === false || !variantId ? "" : `<button class="genie-upsell-button" data-variant="${variantId}">+ ${styles.button_text || "Add"}</button>`}
        </div>
      </div>
    `;
    }).join("");

    grid.querySelectorAll(".genie-upsell-button").forEach((button) => {
      button.addEventListener("click", async (e) => {
        e.preventDefault();
        const variantId = button.dataset.variant;
        if (!variantId) return;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = "Adding...";
        try {
          await addToCartAndOpen(variantId);
          button.textContent = "Added!";
        } catch (_e) {
          button.textContent = "Error";
        }
        setTimeout(() => {
          button.disabled = false;
          button.textContent = original;
        }, 1200);
      });
    });

    if (layout === "carousel" && navNode) {
      const prev = navNode.querySelector(".genie-upsell-prev");
      const next = navNode.querySelector(".genie-upsell-next");
      prev?.addEventListener("click", () => grid.scrollBy({ left: -240, behavior: "smooth" }));
      next?.addEventListener("click", () => grid.scrollBy({ left: 240, behavior: "smooth" }));
    }

    root.style.display = "block";
    debugLog("Widget rendered successfully", {
      page,
      rendered_count: products.length,
      layout
    });
  }

  function observeCartDrawer(root, onOpen) {
    const drawerEl = document.querySelector(
      "cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer]"
    );
    if (!drawerEl) return;

    let rendering = false;
    const rerender = () => {
      if (rendering) return;
      rendering = true;
      root.style.display = "none";
      const grid = root.querySelector(".genie-upsell-grid");
      if (grid) grid.innerHTML = "";
      renderWidget(root).catch(() => {}).finally(() => { rendering = false; });
      if (typeof onOpen === "function") onOpen();
    };

    new MutationObserver((mutations) => {
      for (const m of mutations) {
        const el = m.target;
        const isOpen = el.classList.contains("is-open")
          || el.classList.contains("active")
          || el.classList.contains("open")
          || el.getAttribute("aria-hidden") === "false"
          || el.hasAttribute("open");
        if (isOpen) { rerender(); return; }
      }
    }).observe(drawerEl, { attributes: true, attributeFilter: ["class", "aria-hidden", "open"] });

    // Also catch theme custom events
    ["cart:open", "cart-drawer:open", "CartDrawer:open"].forEach((evt) => {
      document.addEventListener(evt, rerender);
    });
  }

  function boot() {
    const config = window.InvoiceUpsellConfig;
    if (!config) {
      debugLog("No window.InvoiceUpsellConfig found");
      return;
    }
    if (window._InvoiceUpsellInitDone) return;
    window._InvoiceUpsellInitDone = true;

    const productData = window.InvoiceUpsellProduct || null;
    const pageType = window.InvoiceUpsellPageType || "";
    const pages = ["cart_drawer"];
    if (productData?.id) pages.unshift("product_page");
    if (pageType === "cart") pages.push("cart_page");

    function refreshCartFeatures() {
      fetchCart().then((cart) => {
        renderDiscountUpsell(config, pageType, cart).catch(() => {});
        renderFreeShippingBar(config, pageType, cart).catch(() => {});
      });
    }

    pages.forEach((page) => {
      const root = createWidgetElement(page, config, productData);
      document.body.appendChild(root);
      renderWidget(root).catch(() => {});
      if (page === "cart_drawer") observeCartDrawer(root, refreshCartFeatures);
    });

    refreshCartFeatures();
    renderBundleOffers(config, pageType).catch(() => {});
    renderTimer(config);
  }

  function invoiceUpsellInit() {
    boot();
  }
  window.InvoiceUpsellInit = invoiceUpsellInit;
})();
