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

  const domains = domain.split(',').map(n => n.trim());
  const host =
    hostUrl || '__COLLECT_API_HOST__' || currentScript.src.split('/').slice(0, -1).join('/');
  const endpoint = `${host.replace(/\/$/, '')}__COLLECT_API_ENDPOINT__`;
  const screen = `${width}x${height}`;
  // Support both data-hanzo-event and data-umami-event
  const eventRegex = /data-(?:hanzo|umami)-event-([\w-_]+)/;
  const eventNameAttribute = `${_data}hanzo-event`;
  const eventNameAttributeLegacy = `${_data}umami-event`;
  const delayDuration = 300;

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
      const elements = section.querySelectorAll(
        'a[href], button, input, [data-hanzo-event], [data-umami-event]',
      );
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
      const eventName =
        el.getAttribute(eventNameAttribute) || el.getAttribute(eventNameAttributeLegacy);
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
      if (
        !parentElement.getAttribute(eventNameAttribute) &&
        !parentElement.getAttribute(eventNameAttributeLegacy)
      )
        return;

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
    localStorage?.getItem('umami.disabled') ||
    (domain && !domains.includes(hostname)) ||
    (dnt && hasDoNotTrack());

  const send = async (payload, type = 'event') => {
    if (trackingDisabled()) return;

    const callback = window[beforeSend];

    if (typeof callback === 'function') {
      payload = await Promise.resolve(callback(type, payload));
    }

    if (!payload) return;

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

  // Expose as both window.hanzo and window.umami (backwards compat)
  if (!window.hanzo) window.hanzo = tracker;
  if (!window.umami) window.umami = tracker;

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
