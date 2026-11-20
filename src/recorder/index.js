import { record } from 'rrweb';

(window => {
  const { document, location, history } = window;
  const { currentScript } = document;
  if (!currentScript) return;

  const _data = 'data-';
  const attr = currentScript.getAttribute.bind(currentScript);
  const config = value => attr(`${_data}${value}`);

  const website = config(`website-id`);
  const hostUrl = config(`host-url`);
  const sampleRate = parseFloat(config(`sample-rate`) || '0.15');
  const maskLevel = config(`mask-level`) || 'moderate';
  const maxDuration = parseInt(config(`max-duration`) || '300000', 10);
  const blockSelector = config(`block-selector`) || '';

  if (!website) return;

  // Privacy-first pre-capture route exclusion (enforced BEFORE serialization/transmission)
  const EXCLUDED_ROUTES = [
    /^\/auth\/callback(?:\/|$)/i,
    /^\/oauth\/callback(?:\/|$)/i,
    /^\/login\/callback(?:\/|$)/i,
    /^\/pay\/confirm(?:\/|$)/i,
    /^\/pay\/card(?:\/|$)/i,
    /^\/checkout\/payment(?:\/|$)/i,
  ];

  const SENSITIVE_TEXT_SELECTOR =
    '[data-hanzo-mask], [data-conversation-body], .conversation-body, [data-secret]';

  const SENSITIVE_INPUT_PATTERN =
    /(password|passcode|passwd|card|cc[-_]?num|cc[-_]?exp|cc[-_]?csc|credit[-_]?card|cardnumber|\bpan\b|cvv|cvc|csc|security[-_]?code|iban|routing|bank[-_]?account|account[-_]?num|swift|bic|secret|api[-_]?key|apikey|access[-_]?key|private[-_]?key|client[-_]?secret|auth[-_]?token|bearer)/i;

  const MASKED = '********';

  const isExcludedRoute = rawUrl => {
    try {
      const parsed = new URL(rawUrl || location.href, location.origin || 'https://hanzo.ai');
      const pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      return EXCLUDED_ROUTES.some(re => re.test(pathname));
    } catch {
      return false;
    }
  };

  const isSensitiveElement = el => {
    if (!el || typeof el !== 'object') return false;
    try {
      if (typeof el.closest === 'function' && el.closest(SENSITIVE_TEXT_SELECTOR)) {
        return true;
      }
    } catch {}
    const type = (el.type || el.getAttribute?.('type') || '').toLowerCase();
    if (type === 'password') return true;
    const fields = [
      el.name,
      el.id,
      el.getAttribute?.('autocomplete'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('data-control-id'),
      typeof el.className === 'string' ? el.className : '',
    ].filter(Boolean);
    return fields.some(f => SENSITIVE_INPUT_PATTERN.test(String(f)));
  };

  // Sample rate check
  if (sampleRate < 1 && Math.random() > sampleRate) return;

  const host =
    hostUrl || '__COLLECT_API_HOST__' || currentScript.src.split('/').slice(0, -1).join('/');
  const endpoint = `${host.replace(/\/$/, '')}__COLLECT_REPLAY_ENDPOINT__`;

  const FLUSH_EVENT_COUNT = 100;
  const FLUSH_INTERVAL = 10000;

  let eventBuffer = [];
  let stopFn = null;
  let flushTimer = null;
  let startTime = null;
  let stopped = false;
  let routePaused = isExcludedRoute(location.href);

  const tracker = () => window.hanzo;

  let chunkIndex = 0;

  const sendEvents = (events, useKeepalive = false) => {
    if (routePaused || isExcludedRoute(location.href)) return;

    const session = tracker()?.getSession?.();
    if (!session?.cache) return;

    const now = Date.now();
    const body = JSON.stringify({
      type: 'record',
      payload: {
        website,
        url: location.pathname,
        events,
        chunkIndex: chunkIndex++,
        startedAt: startTime,
        endedAt: now,
        timestamp: Math.floor(now / 1000),
      },
    });

    const keepalive = useKeepalive && body.length < 60000;

    return fetch(endpoint, {
      keepalive,
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        // Must match what /v1/send and /v1/record read.
        'x-cache-hint': session.cache,
      },
      credentials: 'omit',
    }).catch(() => {});
  };

  const flush = (useKeepalive = false) => {
    if (!eventBuffer.length) return;

    const events = eventBuffer;
    eventBuffer = [];

    if (routePaused || isExcludedRoute(location.href)) return;
    sendEvents(events, useKeepalive);
  };

  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_INTERVAL);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (flushTimer) clearTimeout(flushTimer);
    flush();
    if (stopFn) stopFn();
  };

  const getMaskConfig = level => {
    const baseTextSelector = level === 'strict' ? '*' : SENSITIVE_TEXT_SELECTOR;
    return {
      maskAllInputs: true,
      maskTextSelector: baseTextSelector,
      maskInputOptions: {
        password: true,
        text: true,
        textarea: true,
        email: true,
        tel: true,
        number: true,
        search: true,
        url: true,
        select: true,
      },
      maskInputFn: (value, element) => {
        if (!value) return value;
        if (isSensitiveElement(element)) return MASKED;
        return MASKED;
      },
      maskTextFn: (text, element) => {
        if (!text) return text;
        if (level === 'strict' || isSensitiveElement(element)) return MASKED;
        return text;
      },
    };
  };

  const syncRoutePolicy = () => {
    const excluded = isExcludedRoute(location.href);
    if (excluded) {
      routePaused = true;
      eventBuffer = [];
      if (stopFn) {
        stopFn();
        stopFn = null;
      }
      return;
    }

    if (routePaused && !excluded && !stopped) {
      routePaused = false;
      if (!stopFn) {
        waitForSession();
      }
    }
  };

  const watchRouteTransitions = () => {
    if (history && typeof history.pushState === 'function') {
      const origPush = history.pushState;
      history.pushState = (...args) => {
        const res = origPush.apply(history, args);
        syncRoutePolicy();
        return res;
      };
    }
    if (history && typeof history.replaceState === 'function') {
      const origReplace = history.replaceState;
      history.replaceState = (...args) => {
        const res = origReplace.apply(history, args);
        syncRoutePolicy();
        return res;
      };
    }
    window.addEventListener('popstate', syncRoutePolicy);
  };

  const waitForSession = (attempts = 0) => {
    if (stopped || isExcludedRoute(location.href)) return;
    if (attempts > 50) return;

    const session = tracker()?.getSession?.();
    if (session?.cache) {
      beginRecording();
    } else {
      setTimeout(() => waitForSession(attempts + 1), 100);
    }
  };

  const beginRecording = () => {
    if (stopped || stopFn || isExcludedRoute(location.href)) return;
    routePaused = false;
    startTime = Date.now();

    const maskConfig = getMaskConfig(maskLevel);

    stopFn = record({
      emit(event) {
        if (stopped || routePaused || isExcludedRoute(location.href)) {
          eventBuffer = [];
          return;
        }

        if (Date.now() - startTime > maxDuration) {
          stop();
          return;
        }

        eventBuffer.push(event);

        if (eventBuffer.length >= FLUSH_EVENT_COUNT) {
          flush();
        }

        scheduleFlush();
      },
      ...maskConfig,
      inlineStylesheet: true,
      slimDOMOptions: {
        script: true,
        comment: true,
        headMetaDescKeywords: true,
        headMetaSocial: true,
        headMetaRobots: true,
        headMetaHttpEquiv: true,
        headMetaAuthorship: true,
        headMetaVerification: true,
      },
      recordCanvas: false,
      recordCrossOriginIframes: false,
      checkoutEveryNms: 30000,
      ...(blockSelector && { blockSelector }),
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });

    window.addEventListener('beforeunload', () => flush(true));
  };

  watchRouteTransitions();

  if (document.readyState === 'complete') {
    waitForSession();
  } else {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'complete') waitForSession();
    });
  }
})(window);
