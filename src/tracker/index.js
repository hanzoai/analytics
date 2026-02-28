(window => {
  const {
    screen: { width, height },
    navigator: { language, doNotTrack: ndnt, msDoNotTrack: msdnt },
    location,
    document,
    history,
    top,
    doNotTrack,
  } = window;
  const { currentScript, referrer } = document;
  if (!currentScript) return;

  const { hostname, href, origin } = location;
  const localStorage = href.startsWith('data:') ? undefined : window.localStorage;

  const _data = 'data-';
  const _false = 'false';
  const _true = 'true';
  const attr = currentScript.getAttribute.bind(currentScript);

  const website = attr(`${_data}website-id`);
  const hostUrl = attr(`${_data}host-url`);
  const beforeSend = attr(`${_data}before-send`);
  const tag = attr(`${_data}tag`) || undefined;
  const autoTrack = attr(`${_data}auto-track`) !== _false;
  const dnt = attr(`${_data}do-not-track`) === _true;
  const excludeSearch = attr(`${_data}exclude-search`) === _true;
  const excludeHash = attr(`${_data}exclude-hash`) === _true;
  const domain = attr(`${_data}domains`) || '';
  const credentials = attr(`${_data}fetch-credentials`) || 'omit';
  const astEnabled = attr(`${_data}ast`) !== _false;

  // Third-party analytics provider keys (unified tracking)
  const gaId = attr(`${_data}ga-id`);
  const fbPixelId = attr(`${_data}fb-pixel-id`);
  const ttPixelId = attr(`${_data}tt-pixel-id`);
  const gtmId = attr(`${_data}gtm-id`);
  const linkedinId = attr(`${_data}linkedin-id`);
  const pinterestId = attr(`${_data}pinterest-id`);
  const snapPixelId = attr(`${_data}snap-pixel-id`);
  const plausibleDomain = attr(`${_data}plausible-domain`);

  const domains = domain.split(',').map(n => n.trim());
  const host =
    hostUrl || '__COLLECT_API_HOST__' || currentScript.src.split('/').slice(0, -1).join('/');
  const endpoint = `${host.replace(/\/$/, '')}__COLLECT_API_ENDPOINT__`;
  const screen = `${width}x${height}`;
  const eventRegex = /data-hanzo-event-([\w-_]+)/;
  const eventNameAttribute = `${_data}hanzo-event`;
  const delayDuration = 300;

  /* Third-party provider initialization */

  const initProviders = () => {
    // Google Analytics (gtag.js)
    if (gaId) {
      const gs = document.createElement('script');
      gs.async = true;
      gs.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
      document.head.appendChild(gs);
      window.dataLayer = window.dataLayer || [];
      window.gtag = (...args) => {
        window.dataLayer.push(args);
      };
      window.gtag('js', new Date());
      window.gtag('config', gaId, { send_page_view: false });
    }

    // Google Tag Manager
    if (gtmId) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      const gs = document.createElement('script');
      gs.async = true;
      gs.src = `https://www.googletagmanager.com/gtm.js?id=${gtmId}`;
      document.head.appendChild(gs);
    }

    // Facebook Pixel
    if (fbPixelId) {
      if (!window.fbq) {
        const q = [];
        window.fbq = (...args) => {
          q.push(args);
        };
        window.fbq.q = q;
      }
      window.fbq.version = '2.0';
      window.fbq('init', fbPixelId);
      const fs = document.createElement('script');
      fs.async = true;
      fs.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(fs);
    }

    // TikTok Pixel
    if (ttPixelId) {
      window.ttq = window.ttq || { _i: {}, _o: {}, _w: {}, _s: {} };
      window.ttq.methods = [
        'page',
        'track',
        'identify',
        'instances',
        'debug',
        'on',
        'off',
        'once',
        'ready',
        'alias',
        'group',
        'enableCookie',
        'disableCookie',
      ];
      window.ttq.setAndDefer = (t, e) => {
        t[e] = (...args) => {
          t._q.push([e, args]);
        };
      };
      window.ttq._q = [];
      window.ttq.methods.forEach(e => {
        window.ttq.setAndDefer(window.ttq, e);
      });
      window.ttq.instance = t => {
        if (!window.ttq._i[t]) {
          window.ttq._i[t] = { _q: [] };
        }
        return window.ttq._i[t];
      };
      window.ttq.load = e => {
        const s = document.createElement('script');
        s.async = true;
        s.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${e}`;
        document.head.appendChild(s);
      };
      window.ttq.load(ttPixelId);
      window.ttq.page();
    }

    // LinkedIn Insight Tag
    if (linkedinId) {
      window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
      window._linkedin_data_partner_ids.push(linkedinId);
      const ls = document.createElement('script');
      ls.async = true;
      ls.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js';
      document.head.appendChild(ls);
    }

    // Pinterest Tag
    if (pinterestId) {
      if (!window.pintrk) {
        const q = [];
        window.pintrk = (...args) => {
          q.push(args);
        };
        window.pintrk.q = q;
      }
      const ps = document.createElement('script');
      ps.async = true;
      ps.src = 'https://s.pinimg.com/ct/core.js';
      document.head.appendChild(ps);
      window.pintrk('load', pinterestId);
      window.pintrk('page');
    }

    // Snapchat Pixel
    if (snapPixelId) {
      if (!window.snaptr) {
        const q = [];
        window.snaptr = (...args) => {
          q.push(args);
        };
        window.snaptr.q = q;
      }
      const ss = document.createElement('script');
      ss.async = true;
      ss.src = 'https://sc-static.net/scevent.min.js';
      document.head.appendChild(ss);
      window.snaptr('init', snapPixelId);
      window.snaptr('track', 'PAGE_VIEW');
    }
  };

  /* Forward events to third-party providers */

  const forwardPageView = (url, title) => {
    if (gaId && window.gtag) {
      window.gtag('event', 'page_view', { page_location: url, page_title: title });
    }
    if (fbPixelId && window.fbq) {
      window.fbq('track', 'PageView');
    }
    if (plausibleDomain) {
      try {
        navigator.sendBeacon?.(
          'https://plausible.io/api/event',
          JSON.stringify({ n: 'pageview', u: url, d: plausibleDomain, r: referrer }),
        );
      } catch {}
    }
  };

  const forwardEvent = (name, data) => {
    if (gaId && window.gtag) {
      window.gtag('event', name, data || {});
    }
    if (fbPixelId && window.fbq) {
      window.fbq('trackCustom', name, data || {});
    }
    if (ttPixelId && window.ttq) {
      window.ttq.track(name, data || {});
    }
    if (pinterestId && window.pintrk) {
      window.pintrk('track', 'custom', { event_name: name, ...(data || {}) });
    }
    if (snapPixelId && window.snaptr) {
      window.snaptr('track', name, data || {});
    }
    if (plausibleDomain) {
      try {
        navigator.sendBeacon?.(
          'https://plausible.io/api/event',
          JSON.stringify({
            n: name,
            u: location.href,
            d: plausibleDomain,
            p: data ? JSON.stringify(data) : undefined,
          }),
        );
      } catch {}
    }
  };

  /* Helper functions */

  const normalize = raw => {
    if (!raw) return raw;
    try {
      const u = new URL(raw, location.href);
      if (excludeSearch) u.search = '';
      if (excludeHash) u.hash = '';
      return u.toString();
    } catch {
      return raw;
    }
  };

  const getPayload = () => ({
    website,
    screen,
    language,
    title: document.title,
    hostname,
    url: currentUrl,
    referrer: currentRef,
    tag,
    id: identity ? identity : undefined,
  });

  const hasDoNotTrack = () => {
    const dnt = doNotTrack || ndnt || msdnt;
    return dnt === 1 || dnt === '1' || dnt === 'yes';
  };

  /* AST / Structured Data Collection */

  const collectAST = () => {
    if (!astEnabled) return;

    const ast = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      head: {
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || '',
      },
      sections: [],
      url: currentUrl,
    };

    // Collect JSON-LD structured data from the page
    const jsonld = document.querySelectorAll('script[type="application/ld+json"]');
    if (jsonld.length) {
      ast.structured = [];
      jsonld.forEach(el => {
        try {
          ast.structured.push(JSON.parse(el.textContent));
        } catch {}
      });
    }

    // Collect semantic sections
    const sections = document.querySelectorAll(
      'section, [data-section], main, article, aside, nav, header, footer',
    );
    sections.forEach(section => {
      const s = {
        name: section.getAttribute('data-section') || section.getAttribute('aria-label') || '',
        type: section.tagName.toLowerCase(),
        id: section.id || '',
        content: [],
      };

      // Sample key interactive elements within the section
      const elements = section.querySelectorAll('a[href], button, input, [data-hanzo-event]');
      elements.forEach(el => {
        if (s.content.length >= 20) return; // cap per section
        s.content.push({
          type: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 100),
          href: el.href || '',
        });
      });

      if (s.name || s.id || s.content.length > 0) {
        ast.sections.push(s);
      }
    });

    // Send AST data
    if (ast.sections.length > 0 || (ast.structured && ast.structured.length > 0)) {
      sendAST(ast);
    }
  };

  const sendAST = async payload => {
    if (trackingDisabled()) return;
    try {
      await fetch(`${host.replace(/\/$/, '')}/api/ast`, {
        keepalive: true,
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        credentials,
      });
    } catch {}
  };

  /* Element interaction tracking */

  const trackElement = async (el, eventName) => {
    if (trackingDisabled()) return;
    try {
      await fetch(`${host.replace(/\/$/, '')}/api/element`, {
        keepalive: true,
        method: 'POST',
        body: JSON.stringify({
          website,
          url: currentUrl,
          elementId: el.id || '',
          elementType: el.tagName.toLowerCase(),
          elementSelector: el.className ? `.${el.className.split(' ')[0]}` : '',
          elementText: (el.textContent || '').trim().substring(0, 200),
          elementHref: el.href || '',
          event: eventName || '',
        }),
        headers: { 'Content-Type': 'application/json' },
        credentials,
      });
    } catch {}
  };

  /* Event handlers */

  const handlePush = (_state, _title, url) => {
    if (!url) return;

    currentRef = currentUrl;
    currentUrl = normalize(new URL(url, location.href).toString());

    if (currentUrl !== currentRef) {
      setTimeout(() => {
        track();
        collectAST();
      }, delayDuration);
    }
  };

  const handlePathChanges = () => {
    const hook = (_this, method, callback) => {
      const orig = _this[method];
      return (...args) => {
        callback.apply(null, args);
        return orig.apply(_this, args);
      };
    };

    history.pushState = hook(history, 'pushState', handlePush);
    history.replaceState = hook(history, 'replaceState', handlePush);
  };

  const handleClicks = () => {
    const trackEventElement = async el => {
      const eventName = el.getAttribute(eventNameAttribute);
      if (eventName) {
        const eventData = {};

        el.getAttributeNames().forEach(name => {
          const match = name.match(eventRegex);
          if (match) eventData[match[1]] = el.getAttribute(name);
        });

        // Also send element-level tracking for AST
        trackElement(el, eventName);

        return track(eventName, eventData);
      }
    };
    const onClick = async e => {
      const el = e.target;
      const parentElement = el.closest('a,button');
      if (!parentElement) return trackEventElement(el);

      const { href, target } = parentElement;
      if (!parentElement.getAttribute(eventNameAttribute)) return;

      if (parentElement.tagName === 'BUTTON') {
        return trackEventElement(parentElement);
      }
      if (parentElement.tagName === 'A' && href) {
        const external =
          target === '_blank' ||
          e.ctrlKey ||
          e.shiftKey ||
          e.metaKey ||
          (e.button && e.button === 1);
        if (!external) e.preventDefault();
        return trackEventElement(parentElement).then(() => {
          if (!external) {
            (target === '_top' ? top.location : location).href = href;
          }
        });
      }
    };
    document.addEventListener('click', onClick, true);
  };

  /* Section visibility tracking */

  const handleSections = () => {
    if (!astEnabled || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const section = entry.target;
          if (section._tracked) return;
          section._tracked = true;

          const name =
            section.getAttribute('data-section') ||
            section.getAttribute('aria-label') ||
            section.id ||
            '';
          if (!name) return;

          fetch(`${host.replace(/\/$/, '')}/api/section`, {
            keepalive: true,
            method: 'POST',
            body: JSON.stringify({
              website,
              url: currentUrl,
              sectionName: name,
              sectionType: section.tagName.toLowerCase(),
              sectionId: section.id || '',
            }),
            headers: { 'Content-Type': 'application/json' },
            credentials,
          }).catch(() => {});
        });
      },
      { threshold: 0.5 },
    );

    document
      .querySelectorAll('section[data-section], [data-section], section[aria-label]')
      .forEach(el => {
        observer.observe(el);
      });
  };

  /* Tracking functions */

  const trackingDisabled = () =>
    disabled ||
    !website ||
    localStorage?.getItem('hanzo.analytics.disabled') ||
    (domain && !domains.includes(hostname)) ||
    (dnt && hasDoNotTrack());

  const send = async (payload, type = 'event') => {
    if (trackingDisabled()) return;

    const callback = window[beforeSend];

    if (typeof callback === 'function') {
      payload = await Promise.resolve(callback(type, payload));
    }

    if (!payload) return;

    // Forward to third-party providers
    if (type === 'event') {
      if (payload.name) {
        forwardEvent(payload.name, payload.data);
      } else {
        forwardPageView(payload.url, payload.title);
      }
    }

    try {
      const res = await fetch(endpoint, {
        keepalive: true,
        method: 'POST',
        body: JSON.stringify({ type, payload }),
        headers: {
          'Content-Type': 'application/json',
          ...(typeof cache !== 'undefined' && { 'x-hanzo-cache': cache }),
        },
        credentials,
      });

      const data = await res.json();
      if (data) {
        disabled = !!data.disabled;
        cache = data.cache;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_e) {
      /* no-op */
    }
  };

  const init = () => {
    if (!initialized) {
      initialized = true;
      initProviders();
      track();
      handlePathChanges();
      handleClicks();
      // Collect AST after page is ready
      setTimeout(collectAST, 100);
      setTimeout(handleSections, 500);
    }
  };

  const track = (name, data) => {
    if (typeof name === 'string') return send({ ...getPayload(), name, data });
    if (typeof name === 'object') return send({ ...name });
    if (typeof name === 'function') return send(name(getPayload()));
    return send(getPayload());
  };

  const identify = (id, data) => {
    if (typeof id === 'string') {
      identity = id;
    }

    cache = '';
    return send(
      {
        ...getPayload(),
        data: typeof id === 'object' ? id : data,
      },
      'identify',
    );
  };

  /* Start */

  const tracker = { track, identify };

  if (!window.hanzo) window.hanzo = tracker;

  let currentUrl = normalize(href);
  let currentRef = normalize(referrer.startsWith(origin) ? '' : referrer);

  let initialized = false;
  let disabled = false;
  let cache;
  let identity;

  if (autoTrack && !trackingDisabled()) {
    if (document.readyState === 'complete') {
      init();
    } else {
      document.addEventListener('readystatechange', init, true);
    }
  }
})(window);
