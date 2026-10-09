(function () {
  function invoiceGetProxyBase() {
    var embed = document.getElementById("invoice-feature-embed");
    var base = embed && embed.getAttribute("data-proxy-base");
    return String(base || "/apps/pdf-invoice")
      .trim()
      .replace(/\/$/, "");
  }

  function invoiceGetAppBase() {
    var embed = document.getElementById("invoice-feature-embed");
    var base =
      (embed && embed.getAttribute("data-app-url")) ||
      (document.getElementById("invoice-extras-domain") &&
        document
          .getElementById("invoice-extras-domain")
          .getAttribute("data-app-url")) ||
      "";
    return String(base || "")
      .trim()
      .replace(/\/$/, "");
  }

  function invoiceGetShopDomain() {
    var span = document.getElementById("invoice-extras-domain");
    var domain = span && span.getAttribute("data-store-domain");
    if (domain) return String(domain).trim().toLowerCase();
    var input = document.getElementById("invoice-shopify-domain");
    return input && input.value
      ? String(input.value).trim().toLowerCase()
      : "";
  }

  function fetchJson(url) {
    return fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: url.indexOf("http") === 0 ? "omit" : "same-origin",
    }).then(function (res) {
      if (!res.ok) throw new Error("bad response");
      return res.json();
    });
  }

  /** Try app proxy first, then absolute app URL with shopify_domain. */
  function fetchStorefront(path) {
    var shop = invoiceGetShopDomain();
    var proxyUrl = invoiceGetProxyBase() + path;
    var appBase = invoiceGetAppBase();
    var absoluteUrl =
      appBase && shop
        ? appBase +
          "/api/storefront" +
          path +
          (path.indexOf("?") >= 0 ? "&" : "?") +
          "shopify_domain=" +
          encodeURIComponent(shop)
        : "";

    return fetchJson(proxyUrl).catch(function () {
      if (!absoluteUrl) throw new Error("no fallback");
      return fetchJson(absoluteUrl);
    });
  }

  var PRESET_SVGS = {
    shield:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
    checkmark:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    truck:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
    heart:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    verified:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.69 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"/></svg>',
    secure:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>',
    payment:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>',
    fast: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/></svg>',
    return:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>',
    quality:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z"/></svg>',
    support:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>',
    certificate:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M4 3h16v12H4zm8 14l-4 4v-4H4v-2h16v2h-4v4z"/></svg>',
    award:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V17H7v2h10v-2h-4v-1.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>',
    badge:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>',
  };

  function getIconHtml(badge) {
    var size = Number(badge.font_size);
    if (!size || size < 1) size = 14;

    if (badge.icon_type !== "preset" && badge.icon_value) {
      return (
        '<img src="' +
        badge.icon_value +
        '" alt="" class="invoice-tb-icon-img" style="width:' +
        size +
        "px;height:" +
        size +
        'px" />'
      );
    }

    var svg = PRESET_SVGS[badge.icon_value] || PRESET_SVGS["shield"];
    svg = svg
      .replace(/width="\d+"/, 'width="' + size + '"')
      .replace(/height="\d+"/, 'height="' + size + '"');

    return (
      '<span class="invoice-tb-icon-svg" style="color:' +
      badge.text_color +
      '">' +
      svg +
      "</span>"
    );
  }

  function renderBadges(badges) {
    if (!badges || badges.length === 0) return;

    var container = document.createElement("div");
    container.id = "invoice-trusted-badges";
    container.className = "invoice-trusted-badges";

    badges.forEach(function (badge) {
      var size = Number(badge.font_size);
      if (!size || size < 1) size = 14;
      var radius = Number(badge.border_radius);
      if (!Number.isFinite(radius) || radius < 0) radius = 4;

      var item = document.createElement("div");
      item.className = "invoice-tb-badge";
      item.style.backgroundColor = badge.badge_color;
      item.style.borderRadius = radius + "px";
      item.style.fontSize = size + "px";

      item.innerHTML =
        getIconHtml(badge) +
        '<span class="invoice-tb-label" style="color:' +
        badge.text_color +
        ";font-size:" +
        size +
        'px;line-height:1">' +
        badge.label_text +
        "</span>";

      container.appendChild(item);
    });

    var injected = false;

    var buyNowContainer =
      document.querySelector(".shopify-payment-button") ||
      document.querySelector('[data-shopify="payment-button"]') ||
      document.querySelector(".product-form__buttons");
    if (buyNowContainer && !injected) {
      buyNowContainer.insertAdjacentElement("afterend", container);
      injected = true;
    }

    if (!injected) {
      var addToCartBtn =
        document.querySelector(
          'form[action="/cart/add"] button[type="submit"]',
        ) ||
        document.querySelector('button[name="add"]') ||
        document.querySelector(".product-form__submit") ||
        document.querySelector('button[type="submit"][name="add"]');
      if (addToCartBtn) {
        addToCartBtn.insertAdjacentElement("afterend", container);
        injected = true;
      }
    }

    if (!injected) {
      var checkoutBtn =
        document.querySelector('[name="checkout"]') ||
        document.querySelector('[value="checkout"]') ||
        document.querySelector(
          'form[action="/checkout"] button[type="submit"]',
        );
      if (checkoutBtn) {
        checkoutBtn.insertAdjacentElement("afterend", container);
        injected = true;
      }
    }

    if (!injected) {
      document.body.appendChild(container);
    }
  }

  function loadTrustedBadges() {
    if (document.getElementById("invoice-trusted-badges")) return;
    if (!invoiceGetShopDomain()) return;

    fetchStorefront("/trusted-badges")
      .then(function (badges) {
        renderBadges(badges);
      })
      .catch(function () {});
  }

  function invoiceTrustedBadgesInit() {
    loadTrustedBadges();
  }
  window.InvoiceTrustedBadgesInit = invoiceTrustedBadgesInit;
})();
