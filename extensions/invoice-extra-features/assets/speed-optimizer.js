(function () {
  function invoiceGetProxyBase() {
    var embed = document.getElementById('invoice-feature-embed');
    var base = embed && embed.getAttribute('data-proxy-base');
    return String(base || '/apps/pdf-invoice').trim().replace(/\/$/, '');
  }

  var prefetchedUrls = new Set();
  var prefetchLimit = 10;
  var excludedPages = [];
  var initialized = false;

  function getShopDomain() {
    var el = document.getElementById('invoice-extras-domain');
    return el ? el.getAttribute('data-store-domain') : null;
  }

  function isSameOrigin(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function isExcluded(url) {
    try {
      var parsed = new URL(url, window.location.href);
      var path = parsed.pathname;
      for (var i = 0; i < excludedPages.length; i++) {
        var excluded = excludedPages[i].trim();
        if (excluded && path.indexOf(excluded) === 0) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function shouldSkip(url) {
    if (!url) return true;
    if (url.indexOf('#') === 0) return true;
    if (url.indexOf('mailto:') === 0) return true;
    if (url.indexOf('tel:') === 0) return true;
    if (!isSameOrigin(url)) return true;
    if (isExcluded(url)) return true;
    try {
      var parsed = new URL(url, window.location.href);
      var full = parsed.href;
      if (prefetchedUrls.has(full)) return true;
    } catch (e) {
      return true;
    }
    if (prefetchedUrls.size >= prefetchLimit) return true;
    return false;
  }

  function prefetch(url) {
    try {
      var parsed = new URL(url, window.location.href);
      var full = parsed.href;
      if (prefetchedUrls.has(full)) return;
      prefetchedUrls.add(full);
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = full;
      link.as = 'document';
      document.head.appendChild(link);
    } catch (e) {}
  }

  function onLinkHover(e) {
    var target = e.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }
    if (!target) return;
    var href = target.getAttribute('href');
    if (shouldSkip(href)) return;
    prefetch(href);
  }

  function initOptimizer() {
    if (initialized) return;
    initialized = true;
    document.addEventListener('mouseover', onLinkHover, { passive: true });
    document.addEventListener('touchstart', onLinkHover, { passive: true });
  }

  function applySettings(data) {
    if (!data || !data.enabled) return;
    if (data.excluded_pages) {
      excludedPages = data.excluded_pages.split(',');
    }
    if (data.prefetch_limit) {
      prefetchLimit = parseInt(data.prefetch_limit, 10) || 10;
    }
    initOptimizer();
  }

  function loadSettings(domain) {
    var proxyUrl = invoiceGetProxyBase() + '/speed-optimizer-settings';
    var embed = document.getElementById('invoice-feature-embed');
    var domainEl = document.getElementById('invoice-extras-domain');
    var appBase = String(
      (embed && embed.getAttribute('data-app-url')) ||
        (domainEl && domainEl.getAttribute('data-app-url')) ||
        '',
    )
      .trim()
      .replace(/\/$/, '');
    var absoluteUrl = appBase
      ? appBase +
        '/api/storefront/speed-optimizer-settings?shopify_domain=' +
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
        if (!absoluteUrl) {
          console.error('[InvoiceSpeedOptimizer] settings fetch failed');
          return;
        }
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
            console.error('[InvoiceSpeedOptimizer] settings fetch failed:', e);
          });
      });
  }

  function init() {
    var domain = getShopDomain();
    if (!domain) return;
    if (window._InvoiceSpeedOptimizerInitStarted) return;
    window._InvoiceSpeedOptimizerInitStarted = true;
    loadSettings(domain);
  }

  function invoiceSpeedOptimizerInit() {
    init();
  }
  window.InvoiceSpeedOptimizerInit = invoiceSpeedOptimizerInit;
})();
