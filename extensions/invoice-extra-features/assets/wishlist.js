(function () {
  'use strict';

  function invoiceGetProxyBase() {
    var embed = document.getElementById('invoice-feature-embed');
    var base = embed && embed.getAttribute('data-proxy-base');
    return String(base || '/apps/pdf-invoice').trim().replace(/\/$/, '');
  }

  var SETTINGS = {};
  var wishlist = [];
  var storageKey = '';

  // ─── Icons ───────────────────────────────────────────────────────────────────

  function heartSvg(filled) {
    var fill = filled ? 'currentColor' : 'none';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">' +
      '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"' +
      ' style="fill:' + fill + ';stroke:currentColor;stroke-width:2;stroke-linejoin:round"/>' +
      '</svg>';
  }

  function starSvg(filled) {
    var fill = filled ? 'currentColor' : 'none';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">' +
      '<polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"' +
      ' style="fill:' + fill + ';stroke:currentColor;stroke-width:2;stroke-linejoin:round"/>' +
      '</svg>';
  }

  function bookmarkSvg(filled) {
    var fill = filled ? 'currentColor' : 'none';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">' +
      '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"' +
      ' style="fill:' + fill + ';stroke:currentColor;stroke-width:2;stroke-linejoin:round"/>' +
      '</svg>';
  }

  function getIcon(filled) {
    var style = SETTINGS.icon_style || 'heart';
    if (style === 'star') return starSvg(filled);
    if (style === 'bookmark') return bookmarkSvg(filled);
    return heartSvg(filled);
  }

  // ─── Storage ─────────────────────────────────────────────────────────────────

  function loadWishlist() {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (e) { return []; }
  }

  function saveWishlist() {
    try { localStorage.setItem(storageKey, JSON.stringify(wishlist)); } catch (e) {}
  }

  function isInWishlist(variantId) {
    return wishlist.some(function (i) { return String(i.variant_id) === String(variantId); });
  }

  function addItem(item) {
    if (!isInWishlist(item.variant_id)) { wishlist.push(item); saveWishlist(); }
  }

  function removeItem(variantId) {
    wishlist = wishlist.filter(function (i) { return String(i.variant_id) !== String(variantId); });
    saveWishlist();
  }

  // ─── CSS vars ────────────────────────────────────────────────────────────────

  function applyVars() {
    var r = document.documentElement;
    r.style.setProperty('--gwl-color',        SETTINGS.icon_color        || '#ff4757');
    r.style.setProperty('--gwl-color-active', SETTINGS.icon_color_active || '#ffffff');
    r.style.setProperty('--gwl-bg',           SETTINGS.bg_color          || '#ffffff');
    r.style.setProperty('--gwl-bg-active',    SETTINGS.bg_color_active   || '#ff4757');
    r.style.setProperty('--gwl-size',         (SETTINGS.icon_size  || 20) + 'px');
    r.style.setProperty('--gwl-pad',          (SETTINGS.padding    || 4)  + 'px');
    r.style.setProperty('--gwl-radius',       (SETTINGS.border_radius || 50) + '%');
  }

  // ─── Badge ───────────────────────────────────────────────────────────────────

  function refreshBadge() {
    var b = document.getElementById('gwl-count');
    if (b) b.textContent = wishlist.length;
  }

  // ─── Header button ───────────────────────────────────────────────────────────

  function injectHeaderBtn() {
    if (document.getElementById('gwl-header-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'gwl-header-btn';
    btn.setAttribute('aria-label', 'Wishlist');
    btn.setAttribute('title', 'Wishlist');
    btn.innerHTML = getIcon(false) + '<span id="gwl-count">' + wishlist.length + '</span>';
    btn.addEventListener('click', openModal);

    var anchors = [
      '.header__icons', '.header-icons', '.site-header__icons',
      '.nav-cart', 'header [class*="cart"]', 'header [class*="icon"]',
      'header nav', 'header'
    ];
    for (var i = 0; i < anchors.length; i++) {
      var el = document.querySelector(anchors[i]);
      if (el) { el.insertBefore(btn, el.firstChild); return; }
    }
    document.body.appendChild(btn);
  }

  // ─── Heart icons on product cards ────────────────────────────────────────────

  function findCardHost(link) {
    return (
      link.closest(
        '.card-wrapper, .product-card-wrapper, .card, [class*="product-card"], .grid__item, li, article',
      ) || link.parentElement
    );
  }

  function cardHasProductMedia(card) {
    return !!(
      card.querySelector(
        '.card__media, .card__inner, [class*="card__media"], [class*="media"], img, picture',
      )
    );
  }

  // Mount on the card root (not inside media/title links) so Dawn's full-card
  // stretch link (::after) does not sit above the heart and steal clicks.
  function findMountHost(card) {
    if (!card) return null;
    if (card.classList && card.classList.contains('card')) return card;
    return card.querySelector(':scope > .card, .card') || card;
  }

  function stopCardNavigation(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }
  }

  function bindHeartButton(btn) {
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'touchstart'].forEach(
      function (type) {
        btn.addEventListener(
          type,
          function (e) {
            stopCardNavigation(e);
            if (type === 'click') handleHeartClick(btn);
          },
          true,
        );
      },
    );
  }

  function injectHeartIcons() {
    var handled = {};

    document.querySelectorAll('a[href*="/products/"]').forEach(function (link) {
      var url = link.getAttribute('href') || '';
      var handle = (url.match(/\/products\/([^?#/]+)/) || [])[1] || '';
      if (!handle || handled[handle]) return;

      var card = findCardHost(link);
      if (!card) return;
      if (!card.closest('[class*="card"], [class*="grid"], [class*="collection"], [class*="list"], li, article')) {
        return;
      }
      if (!cardHasProductMedia(card)) return;
      if (card.querySelector('.gwl-btn')) {
        handled[handle] = true;
        return;
      }

      var host = findMountHost(card);
      if (!host) return;

      handled[handle] = true;

      if (getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
      }
      host.classList.add('gwl-media-host');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'gwl-btn' +
        (SETTINGS.show_on_hover ? ' gwl-hover' : '');
      btn.setAttribute('aria-label', 'Add to wishlist');
      btn.setAttribute('title', 'Wishlist');
      btn.innerHTML = getIcon(false);
      btn.dataset.handle = handle;
      btn.dataset.url = url;

      var stored = wishlist.find(function (i) {
        return i.url === url || (i.url && i.url.indexOf('/products/' + handle) !== -1);
      });
      if (stored) {
        btn.dataset.variantId = stored.variant_id;
        btn.classList.add('gwl-active');
        btn.classList.remove('gwl-hover');
        btn.innerHTML = getIcon(true);
        btn.setAttribute('aria-label', 'Remove from wishlist');
      }

      bindHeartButton(btn);
      host.appendChild(btn);
    });
  }

  function handleHeartClick(btn) {
    var url = btn.dataset.url;
    var handle = btn.dataset.handle;
    var storedVariantId = btn.dataset.variantId;

    // If already wishlisted by this URL, remove it
    if (storedVariantId && isInWishlist(storedVariantId)) {
      removeItem(storedVariantId);
      btn.classList.remove('gwl-active');
      btn.innerHTML = getIcon(false);
      btn.setAttribute('aria-label', 'Add to wishlist');
      if (SETTINGS.show_on_hover) btn.classList.add('gwl-hover');
      refreshBadge();
      return;
    }

    // Also remove by URL match
    var existing = wishlist.find(function (i) { return i.url === url; });
    if (existing) {
      removeItem(existing.variant_id);
      btn.classList.remove('gwl-active');
      btn.innerHTML = getIcon(false);
      btn.setAttribute('aria-label', 'Add to wishlist');
      if (SETTINGS.show_on_hover) btn.classList.add('gwl-hover');
      refreshBadge();
      return;
    }

    // Add: fetch real product data from Shopify API
    btn.classList.add('gwl-active');
    btn.classList.remove('gwl-hover');
    btn.innerHTML = getIcon(true);
    btn.setAttribute('aria-label', 'Remove from wishlist');
    if (SETTINGS.icon_animation === 'bounce') {
      btn.classList.add('gwl-bounce');
      setTimeout(function () { btn.classList.remove('gwl-bounce'); }, 400);
    }

    fetch('/products/' + handle + '.js')
      .then(function (r) { return r.json(); })
      .then(function (p) {
        var img = p.featured_image || (p.images && p.images[0]) || '';
        if (img && img.indexOf('//') === 0) img = 'https:' + img;
        var variantId = p.variants && p.variants[0] ? p.variants[0].id : null;
        if (!variantId) return;
        var available = p.variants[0].available !== false;
        btn.dataset.variantId = variantId;
        addItem({ variant_id: variantId, title: p.title, price: formatMoney(p.price_min || 0), image: img, url: url, available: available });
        refreshBadge();
      })
      .catch(function () {
        // Revert on failure
        btn.classList.remove('gwl-active');
        btn.innerHTML = getIcon(false);
        if (SETTINGS.show_on_hover) btn.classList.add('gwl-hover');
      });
  }

  // ─── Money ───────────────────────────────────────────────────────────────────

  function formatMoney(cents) {
    if (window.Shopify && window.Shopify.formatMoney) {
      try { return window.Shopify.formatMoney(cents); } catch (e) {}
    }
    return (cents / 100).toFixed(2);
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────

  function toast(msg) {
    var t = document.getElementById('gwl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'gwl-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('gwl-toast-show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('gwl-toast-show'); }, 2500);
  }

  // ─── Add to cart (works exactly like theme) ───────────────────────────────────
  // Strategy: POST to /cart/add.js with Shopify Sections API so the theme
  // receives the same response it would from its own form submission,
  // then trigger the same cart-open flow the theme uses.

  function addToCart(variantId, btn) {
    var id = Number(variantId);
    if (!id) { toast('Invalid product variant'); return; }

    btn.disabled = true;
    btn.textContent = 'Adding...';

    // Include cart-drawer in the sections request so the response contains
    // fresh drawer HTML — but we do NOT manually replace cart-drawer innerHTML
    // here. Doing so would destroy the <cart-drawer> custom element before we
    // open it, causing the drawer to appear empty. Instead we pass the full
    // response to openThemeCart which calls drawer.renderContents() so the
    // drawer updates and opens itself in a single atomic step.
    var bubbleSections = ['cart-icon-bubble', 'cart-notification-product', 'cart-notification-button', 'cart-live-region-text'];
    var allSections    = ['cart-drawer'].concat(bubbleSections);

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, quantity: 1, sections: allSections.join(','), sections_url: window.location.pathname })
    })
      .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
      .then(function (resp) {
        // Replace only the bubble / notification sections — never cart-drawer.
        if (resp.sections) {
          bubbleSections.forEach(function (sid) { replaceSectionHTML(sid, resp.sections[sid]); });
        }
        return fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
          updateCartCount(cart.item_count);
          document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: cart }));
          return resp;
        }).catch(function () { return resp; });
      })
      .then(function (resp) {
        btn.textContent = 'Add to cart';
        btn.disabled = false;
        toast('Added to cart ✓');
        closeModal();
        openThemeCart(resp);
      })
      .catch(function () {
        toast('Could not add to cart');
        btn.textContent = 'Add to cart';
        btn.disabled = false;
      });
  }

  function replaceSectionHTML(sid, html) {
    if (!html) return;
    var doc  = new DOMParser().parseFromString(html, 'text/html');
    var next = doc.getElementById('shopify-section-' + sid) || doc.getElementById(sid) || doc.querySelector('[id*="' + sid + '"]');
    var curr = document.getElementById('shopify-section-' + sid) || document.getElementById(sid) || document.querySelector('[id*="' + sid + '"]');
    if (next && curr) curr.innerHTML = next.innerHTML;
  }

  function updateCartCount(n) {
    document.querySelectorAll('[class*="cart-count"], [class*="cart__count"], [data-cart-count], .cart-count-bubble span').forEach(function (el) {
      el.textContent = n;
    });
  }

  // ─── Product page wishlist button ────────────────────────────────────────────

  function injectProductPageBtn() {
    // Only run on product pages
    if (window.location.pathname.indexOf('/products/') === -1) return;
    if (document.getElementById('gwl-product-btn')) return;

    // Find where to inject — after "Buy it now" or after add-to-cart button
    var anchor = document.querySelector(
      '.shopify-payment-button, [data-shopify="payment-button"], ' +
      '.product-form__buttons, .product__buttons, ' +
      '.product-form__submit, form[action="/cart/add"] .btn, ' +
      'form[action*="cart"] [name="add"]'
    );
    if (!anchor) return;

    // Get current variant ID from the page
    var variantInput = document.querySelector('input[name="id"], select[name="id"]');
    var variantId    = variantInput ? variantInput.value : null;

    // Get product handle from URL
    var handle = (window.location.pathname.match(/\/products\/([^?#/]+)/) || [])[1];
    if (!handle) return;

    var btn = document.createElement('button');
    btn.id = 'gwl-product-btn';
    btn.type = 'button';

    function refreshBtn() {
      var stored = wishlist.find(function (i) { return String(i.variant_id) === String(variantId) || i.url.indexOf(handle) !== -1; });
      var active  = !!stored;
      btn.className = 'gwl-product-btn' + (active ? ' gwl-product-btn--active' : '');
      btn.innerHTML = getIcon(active) + '<span>' + (active ? 'Remove from wishlist' : 'Add to wishlist') + '</span>';
      btn.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist');
    }

    refreshBtn();

    btn.addEventListener('click', function () {
      var stored = wishlist.find(function (i) { return String(i.variant_id) === String(variantId) || i.url.indexOf(handle) !== -1; });
      if (stored) {
        removeItem(stored.variant_id);
        refreshBtn();
        refreshBadge();
        // Also uncheck any card heart icons for this product
        document.querySelectorAll('.gwl-btn[data-handle="' + handle + '"]').forEach(function (b) {
          b.classList.remove('gwl-active');
          b.innerHTML = getIcon(false);
          delete b.dataset.variantId;
        });
        return;
      }

      // Fetch real product data and add
      fetch('/products/' + handle + '.js')
        .then(function (r) { return r.json(); })
        .then(function (p) {
          var img = p.featured_image || (p.images && p.images[0]) || '';
          if (img && img.indexOf('//') === 0) img = 'https:' + img;
          // Use the currently selected variant if possible
          var vid = variantId ? Number(variantId) : (p.variants && p.variants[0] ? p.variants[0].id : null);
          if (!vid) return;
          var selectedVariant = p.variants.find(function (v) { return String(v.id) === String(vid); }) || p.variants[0];
          var available = selectedVariant ? selectedVariant.available !== false : false;
          addItem({ variant_id: vid, title: p.title, price: formatMoney(p.price_min || 0), image: img, url: '/products/' + handle, available: available });
          variantId = vid;
          refreshBtn();
          refreshBadge();
        })
        .catch(function () {});
    });

    // Insert after the anchor element
    anchor.parentElement.insertBefore(btn, anchor.nextSibling);

    // Watch for variant changes (when user selects a different size/color)
    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'id') {
        variantId = e.target.value;
        refreshBtn();
      }
    });
  }

  function removeEmptyState(el) {
    // Remove any class on the element that contains "empty"
    // Covers: is-empty, cart--empty, drawer--empty, cart-is-empty, etc.
    Array.prototype.slice.call(el.classList).forEach(function (cls) {
      if (cls.indexOf('empty') !== -1) el.classList.remove(cls);
    });
  }

  function openThemeCart(resp) {
    // ── Drawer themes (Dawn, etc.) ─────────────────────────────────────────────
    // renderContents() is the drawer's own method: it updates the drawer's
    // inner HTML from resp.sections AND opens the drawer in one step.
    // We must NOT replace innerHTML before this call.
    var drawer = document.querySelector('cart-drawer');
    if (drawer) {
      // Remove any "empty" class from the drawer element itself.
      // Every theme uses a different name (is-empty, cart--empty, drawer--empty, etc.)
      // but they all contain the word "empty". renderContents updates innerHTML
      // but never removes these classes from the element itself.
      removeEmptyState(drawer);

      if (typeof drawer.renderContents === 'function' && resp) {
        try { drawer.renderContents(resp); return; } catch (e) {}
      }
      // renderContents not available — fetch fresh HTML, wait a tick for the
      // custom element to initialize after innerHTML swap, then open.
      fetch(window.location.pathname + '?sections=cart-drawer')
        .then(function (r) { return r.json(); })
        .then(function (sections) {
          if (sections['cart-drawer']) replaceSectionHTML('cart-drawer', sections['cart-drawer']);
        })
        .catch(function () {})
        .finally(function () {
          setTimeout(function () {
            var d = document.querySelector('cart-drawer');
            if (!d) return;
            removeEmptyState(d);
            if (typeof d.open === 'function') d.open();
            else d.setAttribute('open', '');
          }, 80);
        });
      return;
    }

    // ── Notification popup themes ──────────────────────────────────────────────
    var notif = document.querySelector('cart-notification');
    if (notif) {
      if (typeof notif.renderContents === 'function' && resp) {
        try { notif.renderContents(resp); return; } catch (e) {}
      }
    }

    // ── Generic / custom themes ────────────────────────────────────────────────
    document.dispatchEvent(new CustomEvent('cart:open',    { bubbles: true }));
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
    var trigger = document.querySelector('[data-cart-toggle], details[id*="cart"] > summary, a[href="/cart"]');
    if (trigger) trigger.click();
  }

  // ─── Modal ───────────────────────────────────────────────────────────────────

  function buildRows() {
    return wishlist.map(function (item) {
      return '<tr data-variant="' + item.variant_id + '">' +
        '<td><div class="gwl-cell">' +
          (item.image ? '<img class="gwl-img" src="' + item.image + '" alt="">' : '') +
          '<a class="gwl-title" href="' + item.url + '">' + item.title + '</a>' +
        '</div></td>' +
        '<td class="gwl-price">' + (item.price || '—') + '</td>' +
        '<td><span class="gwl-stock ' + (item.available === false ? 'gwl-stock--out' : '') + '">' + (item.available === false ? 'Sold out' : 'In stock') + '</span></td>' +
        '<td class="gwl-actions-cell">' +
          '<button class="gwl-add-btn" data-vid="' + item.variant_id + '"' + (item.available === false ? ' disabled' : '') + '>Add to cart</button>' +
          '<button class="gwl-rem-btn" data-vid="' + item.variant_id + '">Remove</button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  function openModal() {
    closeModal();

    var overlay = document.createElement('div');
    overlay.id = 'gwl-overlay';
    overlay.addEventListener('click', closeModal);

    var modal = document.createElement('div');
    modal.id = 'gwl-modal';

    if (wishlist.length === 0) {
      modal.innerHTML =
        '<button class="gwl-close" aria-label="Close">&#x2715;</button>' +
        '<h2 class="gwl-heading">Wishlist</h2>' +
        '<div class="gwl-empty"><div class="gwl-empty-icon">🤍</div>' +
        '<p>Your wishlist is empty.</p>' +
        '<p><a href="/collections/all">Browse products</a></p></div>';
    } else {
      modal.innerHTML =
        '<button class="gwl-close" aria-label="Close">&#x2715;</button>' +
        '<h2 class="gwl-heading">Wishlist Page</h2>' +
        '<p class="gwl-login-msg">To save your wishlist please <a href="/account/login">login</a> or <a href="/account/register">register</a>.</p>' +
        '<hr class="gwl-divider">' +
        '<table class="gwl-table">' +
          '<thead><tr><th>Product name</th><th>Unit price</th><th>Stock status</th><th></th></tr></thead>' +
          '<tbody>' + buildRows() + '</tbody>' +
        '</table>';
    }

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    modal.querySelector('.gwl-close').addEventListener('click', closeModal);

    modal.querySelectorAll('.gwl-add-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { addToCart(btn.dataset.vid, btn); });
    });

    modal.querySelectorAll('.gwl-rem-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var vid = btn.dataset.vid;
        removeItem(vid);
        refreshBadge();

        var row = modal.querySelector('tr[data-variant="' + vid + '"]');
        if (row) row.remove();

        // Uncheck heart on product card
        var cardBtn = document.querySelector('.gwl-btn[data-variant-id="' + vid + '"]');
        if (cardBtn) {
          cardBtn.classList.remove('gwl-active');
          cardBtn.innerHTML = getIcon(false);
          delete cardBtn.dataset.variantId;
          if (SETTINGS.show_on_hover) cardBtn.classList.add('gwl-hover');
        }

        if (wishlist.length === 0) {
          modal.querySelector('.gwl-login-msg') && modal.querySelector('.gwl-login-msg').remove();
          modal.querySelector('.gwl-divider') && modal.querySelector('.gwl-divider').remove();
          var table = modal.querySelector('table');
          if (table) table.outerHTML = '<div class="gwl-empty"><div class="gwl-empty-icon">🤍</div><p>Your wishlist is empty.</p><p><a href="/collections/all">Browse products</a></p></div>';
        }
      });
    });

    document._gwlKey = function (e) { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', document._gwlKey);
  }

  function closeModal() {
    var o = document.getElementById('gwl-overlay');
    var m = document.getElementById('gwl-modal');
    if (o) o.remove();
    if (m) m.remove();
    if (document._gwlKey) { document.removeEventListener('keydown', document._gwlKey); document._gwlKey = null; }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    var el = document.getElementById('invoice-extras-domain');
    if (!el) return;

    var domain = el.getAttribute('data-store-domain') || '';
    if (!domain) return;

    if (window._InvoiceWishlistInitDone) return;
    window._InvoiceWishlistInitDone = true;

    storageKey = 'gwl_' + domain;

    function applySettings(data) {
      if (!data || !data.enabled) return;
      SETTINGS = data;
      wishlist = loadWishlist();
      applyVars();
      injectHeaderBtn();
      injectHeartIcons();
      injectProductPageBtn();

      if (window.MutationObserver) {
        new MutationObserver(function () { injectHeartIcons(); })
          .observe(document.body, { childList: true, subtree: true });
      }
    }

    var proxyUrl = invoiceGetProxyBase() + '/wishlist-settings';
    var embed = document.getElementById('invoice-feature-embed');
    var appBase = String(
      (embed && embed.getAttribute('data-app-url')) ||
        el.getAttribute('data-app-url') ||
        '',
    )
      .trim()
      .replace(/\/$/, '');
    var absoluteUrl = appBase
      ? appBase +
        '/api/storefront/wishlist-settings?shopify_domain=' +
        encodeURIComponent(domain)
      : '';

    fetch(proxyUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) {
        if (!r.ok) throw new Error('bad response');
        return r.json();
      })
      .then(applySettings)
      .catch(function () {
        if (!absoluteUrl) return;
        fetch(absoluteUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit',
        })
          .then(function (r) {
            if (!r.ok) throw new Error('bad response');
            return r.json();
          })
          .then(applySettings)
          .catch(function (e) {
            console.error('[InvoiceWishlist]', e);
          });
      });
  }

  function invoiceWishlistInit() {
    init();
  }
  window.InvoiceWishlistInit = invoiceWishlistInit;

})();
