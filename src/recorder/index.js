import { record } from 'rrweb';

(window => {
  const { document } = window;
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

  // The tracker publishes itself as window.hanzo — the upstream `umami` global was
  // renamed in the white-label and this file was never updated, so every lookup here
  // resolved undefined and the recorder waited out its 50 attempts and gave up.
  const tracker = () => window.hanzo;

  let chunkIndex = 0;

  const sendEvents = (events, useKeepalive = false) => {
    const session = tracker()?.getSession?.();
    if (!session?.cache) return;

    const now = Date.now();
    const body = JSON.stringify({
      type: 'record',
      payload: {
        website,
        events,
        // chunkIndex orders the chunks of ONE recording; the player stitches on it,
        // so it must be monotonic per page and is never derived from arrival order.
        chunkIndex: chunkIndex++,
        startedAt: startTime,
        endedAt: now,
        timestamp: Math.floor(now / 1000),
      },
    });

    // keepalive has a 64KB body limit — only use it for small payloads on unload
    const keepalive = useKeepalive && body.length < 60000;

    return fetch(endpoint, {
      keepalive,
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        // Must match what /api/send reads. This said x-umami-cache, which the route
        // never looks at, so even a recorder that started would have been treated as
        // sessionless and dropped.
        'x-cache-hint': session.cache,
      },
      credentials: 'omit',
    }).catch(() => {});
  };

  const flush = (useKeepalive = false) => {
    if (!eventBuffer.length) return;

    const events = eventBuffer;
    eventBuffer = [];

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
    switch (level) {
      case 'strict':
        return {
          maskAllInputs: true,
          maskTextSelector: '*',
        };
      default: // moderate
        return {
          maskAllInputs: true,
        };
    }
  };

  // The recorder cannot start until the tracker has a session: replay chunks are keyed
  // to session + visit, and a chunk sent before the first pageview has nothing to
  // attach to. Poll for it rather than racing script order.
  const waitForSession = (attempts = 0) => {
    if (attempts > 50) return;

    const session = tracker()?.getSession?.();
    if (session?.cache) {
      beginRecording();
    } else {
      setTimeout(() => waitForSession(attempts + 1), 100);
    }
  };

  const beginRecording = () => {
    startTime = Date.now();

    const maskConfig = getMaskConfig(maskLevel);

    stopFn = record({
      emit(event) {
        if (stopped) return;

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

  if (document.readyState === 'complete') {
    waitForSession();
  } else {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'complete') waitForSession();
    });
  }
})(window);
