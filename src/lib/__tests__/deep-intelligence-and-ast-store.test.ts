import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GET as getAst, POST as postAst } from '@/app/v1/ast/route';
import { POST as postJourneys } from '@/app/v1/journeys/route';
import { clearAstSnapshots } from '@/lib/ast-store';
import {
  attributeErrorEvent,
  compareReleases,
  computeEffortAnalysis,
  computeRageClickAlerts,
  groupSessionErrors,
} from '@/lib/journeys';

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('AST snapshot persistence and multi-release diff', () => {
  beforeEach(() => {
    clearAstSnapshots();
  });

  test('POST /v1/ast persists releases and auto-diffs against the previous release', async () => {
    const r1 = await postAst(
      post('https://analytics.hanzo.ai/v1/ast', {
        url: 'https://hanzo.ai/pricing',
        release: 'rel-100',
        viewport: 'desktop',
        sections: [
          {
            id: 'hero',
            content: [{ control_id: 'cta-start', text: 'Start Free', type: 'button' }],
          },
        ],
      }),
    );
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.release).toBe('rel-100');
    expect(b1.diff).toBeUndefined();

    const r2 = await postAst(
      post('https://analytics.hanzo.ai/v1/ast', {
        url: 'https://hanzo.ai/pricing',
        release: 'rel-101',
        viewport: 'desktop',
        sections: [
          {
            id: 'hero',
            content: [
              { control_id: 'cta-start', text: 'Get Started Now', type: 'button' },
              { control_id: 'cta-demo', text: 'Book Demo', type: 'button' },
            ],
          },
        ],
      }),
    );
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.previous_release).toBe('rel-100');
    expect(b2.diff.summary).toMatchObject({
      sections_changed: 1,
      controls_added: 1,
      controls_changed: 1,
    });

    const listRes = await getAst(
      new Request('https://analytics.hanzo.ai/v1/ast?hostname=hanzo.ai&route_template=/pricing'),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.snapshots.map((s: { release: string }) => s.release)).toEqual([
      'rel-100',
      'rel-101',
    ]);

    const diffRes = await getAst(
      new Request(
        'https://analytics.hanzo.ai/v1/ast?hostname=hanzo.ai&route_template=/pricing&from=rel-100&to=rel-101&viewport=desktop',
      ),
    );
    expect(diffRes.status).toBe(200);
    const diffBody = await diffRes.json();
    expect(diffBody.diff.controls.added).toEqual([{ section: 'hero', control: 'cta-demo' }]);
    expect(diffBody.diff.controls.changed).toEqual([
      { section: 'hero', control: 'cta-start', fields: ['text'] },
    ]);
  });

  test('GET /v1/ast validates missing params and handles missing release cleanly', async () => {
    const bad = await getAst(new Request('https://analytics.hanzo.ai/v1/ast?from=r1&to=r2'));
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.error.message).toContain('hostname and route_template are required');

    const missing = await getAst(
      new Request(
        'https://analytics.hanzo.ai/v1/ast?hostname=hanzo.ai&route_template=/pricing&from=r1&to=r2',
      ),
    );
    expect(missing.status).toBe(200);
    const body = await missing.json();
    expect(body.diff).toBeNull();
    expect(body.found).toEqual({ from: false, to: false });
  });

  test('POST /v1/ast honors explicit normalized route_template and drops excluded route_template', async () => {
    const res = await postAst(
      post('https://analytics.hanzo.ai/v1/ast', {
        url: 'https://hanzo.app/dev/my-app/99',
        route_template: '/projects/my-proj/42',
        sections: [],
      }),
    );
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.route_template).toBe('/projects/:project/:id');

    const excluded = await postAst(
      post('https://analytics.hanzo.ai/v1/ast', {
        route_template: '/pay/confirm/card',
        sections: [],
      }),
    );
    expect(excluded.status).toBe(200);
    expect(await excluded.json()).toMatchObject({ ok: true, dropped: true });

    const partialDiff = await getAst(
      new Request(
        'https://analytics.hanzo.ai/v1/ast?hostname=hanzo.ai&route_template=/pricing&from=r1',
      ),
    );
    expect(partialDiff.status).toBe(400);
  });
});

describe('Deep intelligence algorithms and POST /v1/journeys extensions', () => {
  test('compareReleases flags >=5pp regression and handles empty cohorts', () => {
    const sessions = [
      { session_id: 'a1', release: 'r1', events: ['buy'] },
      { session_id: 'a2', release: 'r1', events: ['buy'] },
      { session_id: 'b1', release: 'r2', events: ['buy'] },
      { session_id: 'b2', release: 'r2', events: [] },
    ];
    const cmp = compareReleases(sessions, 'buy', 'r1', 'r2');
    expect(cmp).toMatchObject({
      rate_a_pct: 100,
      rate_b_pct: 50,
      delta_pct: -50,
      regression: true,
    });

    const empty = compareReleases(sessions, 'buy', 'r1', 'r-missing');
    expect(empty.regression).toBe(false);
    expect(empty.sessions_b).toBe(0);
  });

  test('computeRageClickAlerts ranks by sessions and assigns severity', () => {
    const events = [
      ...Array.from({ length: 10 }, (_, i) => ({
        session_id: `s${i}`,
        control_id: 'broken-submit',
        component_path: 'form[checkout] > button[SubmitOrder]',
        route_template: '/checkout',
        release: 'r2',
      })),
      { session_id: 'x1', control_id: 'minor-tab', route_template: '/docs', release: 'r2' },
    ];
    const alerts = computeRageClickAlerts(events);
    expect(alerts[0]).toMatchObject({
      control_id: 'broken-submit',
      sessions: 10,
      events: 10,
      severity: 'high',
    });
    expect(alerts[1]).toMatchObject({
      control_id: 'minor-tab',
      sessions: 1,
      severity: 'low',
    });
  });

  test('attributeErrorEvent resolves repo, project, component, and fallback fingerprint', () => {
    const attr = attributeErrorEvent({
      error_class: 'TypeError',
      message: 'Cannot read properties of undefined',
      file: 'products/product_analytics/frontend/journeys/AstJourneysScene.tsx',
      line: 120,
      column: 8,
      component_path: 'main[app] > section[journeys] > button[WatchReplay]',
      control_id: 'watch-replay-btn',
      route_template: '/project/:id/journeys',
      hostname: 'insights.hanzo.ai',
      release: 'v1.53.1',
    });
    expect(attr).toMatchObject({
      project: 'insights',
      repo: 'hanzoai/insights',
      component: 'WatchReplay',
      file: 'products/product_analytics/frontend/journeys/AstJourneysScene.tsx',
      line: 120,
    });
    expect(attr.fingerprint).toContain('TypeError:');

    // Strips query tokens, webpack prefix, and resolves repo from file/URL when hostname is omitted
    const stripped = attributeErrorEvent({
      error_class: 'ReferenceError',
      message: 'x is not defined',
      file: 'https://app.hanzo.ai/components/Billing.tsx?token=secret123',
      line: 14,
    });
    expect(stripped).toMatchObject({
      project: 'app',
      repo: 'hanzo-inc/app',
      component: 'Billing',
      file: 'components/Billing.tsx',
    });
    expect(stripped.fingerprint).not.toContain('secret123');
  });

  test('computeEffortAnalysis uses closest preceding funnel step on revisit and handles pre-root visits', () => {
    const steps = [
      { session_id: 's1', step: 'home', step_index: 1 },
      { session_id: 's1', step: 'home', step_index: 5 },
      { session_id: 's1', step: 'buy', step_index: 6 },
      { session_id: 's2', step: 'buy', step_index: 1 },
      { session_id: 's2', step: 'home', step_index: 2 },
      { session_id: 's2', step: 'buy', step_index: 4 },
    ];
    const res = computeEffortAnalysis(steps, ['home', 'buy']);
    expect(res[1].median_interactions).toBe(1.5);
  });

  test('POST /v1/journeys returns release_comparison, rage_click_alerts, and attributed_errors', async () => {
    const res = await postJourneys(
      post('https://analytics.hanzo.ai/v1/journeys', {
        steps: [
          { session_id: 's1', step: 'home', step_index: 1 },
          { session_id: 's1', step: 'buy', step_index: 2 },
        ],
        rootStep: 'home',
        sessions: [
          { session_id: 's1', release: 'r1', events: ['buy'] },
          { session_id: 's2', release: 'r2', events: [] },
        ],
        targetEvent: 'buy',
        releaseA: 'r1',
        releaseB: 'r2',
        rageClicks: [{ session_id: 's2', control_id: 'pay-btn', route_template: '/pay' }],
        errors: [
          {
            error_class: 'TypeError',
            message: 'boom',
            hostname: 'app.hanzo.ai',
            file: 'components/Checkout.tsx',
            line: 55,
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.release_comparison.regression).toBe(true);
    expect(body.rage_click_alerts[0].control_id).toBe('pay-btn');
    expect(body.attributed_errors[0]).toMatchObject({
      project: 'app',
      repo: 'hanzo-inc/app',
      component: 'Checkout',
    });
  });
});

describe('tracker error autocapture and safety guards', () => {
  const src = readFileSync(join(process.cwd(), 'src/tracker/index.js'), 'utf8');
  test('tracker captures errors with dedupe, rate limit, redaction, query stripping, and rAF scroll throttling', () => {
    expect(src).toContain('handleErrors');
    expect(src).toContain("track('$exception'");
    expect(src).toContain('$exception_type');
    expect(src).toContain('errorWindowTimes.length >= 10');
    expect(src).toContain('pruneErrorDedupe');
    expect(src).toContain('stripFileQuery');
    expect(src).toContain('scrubErrorText');
    expect(src).toContain('if (!err && !event?.filename && !event?.lineno) return');
    expect(src).toContain('now - errorDedupe[fingerprint] < 30000');
    expect(src).toContain('[redacted]');
    expect(src).toContain('window.requestAnimationFrame');
  });

  test('tracker parses cleanly and captures console.error, UI error messages, session_id, and breadcrumbs', () => {
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('console_error');
    expect(src).toContain('ui_error_message');
    expect(src).toContain('MutationObserver');
    expect(src).toContain('sessionBreadcrumbs');
    expect(src).toContain('session_id: crossDomainIdentity.hz_sid');
    expect(src).toContain('$session_id: crossDomainIdentity.hz_sid');
    expect(src).toContain('normalizeMessageKey');
    expect(src).toContain('if (el.closest?.(SENSITIVE_MASK_SELECTOR)) return');
  });

  test('tracker runtime execution: captures exceptions, console.error, WCAG live-region alerts, and blocks false positives & masked/excluded leaks', () => {
    const sent: Array<{ url: string; body: any }> = [];
    const windowListeners: Record<string, Array<(e: any) => void>> = {};
    const docListeners: Record<string, Array<(e: any) => void>> = {};
    const storage = new Map<string, string>();
    const sessionStore = new Map<string, string>();
    const makeStorage = (m: Map<string, string>) => ({
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, String(v)),
    });

    type FakeEl = {
      nodeType: number;
      tagName: string;
      textContent: string;
      attrs: Record<string, string>;
      parentElement: FakeEl | null;
      children: FakeEl[];
      getAttribute: (k: string) => string | null;
      hasAttribute: (k: string) => boolean;
      getAttributeNames: () => string[];
      matches: (sel: string) => boolean;
      closest: (sel: string) => FakeEl | null;
      querySelectorAll: (sel: string) => FakeEl[];
    };

    const matchesSingle = (el: FakeEl, rawSel: string): boolean => {
      const sel = rawSel.trim();
      if (sel === '[role="alert"]') return el.attrs.role === 'alert';
      if (sel === '[data-hanzo-error]') return 'data-hanzo-error' in el.attrs;
      if (sel === '[data-error-message]') return 'data-error-message' in el.attrs;
      if (sel === '[aria-live="assertive"]') return el.attrs['aria-live'] === 'assertive';
      if (sel === '[data-hanzo-mask]') return 'data-hanzo-mask' in el.attrs;
      if (sel === '[data-secret]') return 'data-secret' in el.attrs;
      if (sel === 'button') return el.tagName === 'BUTTON';
      if (sel === '[data-control-id]') return 'data-control-id' in el.attrs;
      return false;
    };

    const makeEl = (
      tag: string,
      attrs: Record<string, string> = {},
      text = '',
      parent: FakeEl | null = null,
    ): FakeEl => {
      const el: FakeEl = {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        textContent: text,
        attrs,
        parentElement: parent,
        children: [],
        getAttribute: k => (k in el.attrs ? el.attrs[k] : null),
        hasAttribute: k => k in el.attrs,
        getAttributeNames: () => Object.keys(el.attrs),
        matches: sel => sel.split(',').some(part => matchesSingle(el, part)),
        closest: sel => {
          let cur: FakeEl | null = el;
          while (cur) {
            if (cur.matches(sel)) return cur;
            cur = cur.parentElement;
          }
          return null;
        },
        querySelectorAll: sel => {
          const out: FakeEl[] = [];
          const walk = (n: FakeEl) => {
            for (const c of n.children) {
              if (c.matches(sel)) out.push(c);
              walk(c);
            }
          };
          walk(el);
          return out;
        },
      };
      if (parent) parent.children.push(el);
      return el;
    };

    let moCallback: ((mutations: any[]) => void) | null = null;
    class FakeMutationObserver {
      constructor(cb: (mutations: any[]) => void) {
        moCallback = cb;
      }
      observe() {}
      disconnect() {}
    }

    const scriptEl = makeEl('script', {
      'data-website-id': 'site-123',
      'data-host-url': 'https://analytics.hanzo.ai',
      'data-release': 'v2.4.0',
    });
    const bodyEl = makeEl('body');
    const fakeConsole = { error: jest.fn() };
    const fakeHistory = {
      pushState: jest.fn(),
      replaceState: jest.fn(),
    };
    const fakeWindow: any = {
      screen: { width: 1440, height: 900 },
      innerWidth: 1440,
      innerHeight: 900,
      navigator: { language: 'en-US', doNotTrack: null, msDoNotTrack: null },
      location: {
        hostname: 'app.hanzo.ai',
        href: 'https://app.hanzo.ai/checkout',
        origin: 'https://app.hanzo.ai',
      },
      document: {
        currentScript: Object.assign(scriptEl, { src: 'https://analytics.hanzo.ai/script.js' }),
        referrer: '',
        title: 'Checkout',
        readyState: 'complete',
        body: bodyEl,
        documentElement: { scrollHeight: 1200, scrollTop: 0 },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (ev: string, fn: any) => {
          if (!docListeners[ev]) docListeners[ev] = [];
          docListeners[ev].push(fn);
        },
      },
      history: fakeHistory,
      localStorage: makeStorage(storage),
      sessionStorage: makeStorage(sessionStore),
      addEventListener: (ev: string, fn: any) => {
        if (!windowListeners[ev]) windowListeners[ev] = [];
        windowListeners[ev].push(fn);
      },
      requestAnimationFrame: (fn: any) => fn(),
    };
    fakeWindow.top = fakeWindow;

    const fakeFetch = (url: string, init: any) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ json: async () => ({ cache: 'tok' }) });
    };

    const runnable = src
      .replace('__COLLECT_API_HOST__', '')
      .replace('__COLLECT_API_ENDPOINT__', '/v1/send');

    const runner = new Function(
      'window',
      'fetch',
      'MutationObserver',
      'console',
      'setTimeout',
      runnable,
    );
    runner(fakeWindow, fakeFetch, FakeMutationObserver, fakeConsole, () => 0);

    // 1. Simulate click breadcrumb before crash
    const payBtn = makeEl('button', { 'data-control-id': 'pay-now-btn' }, 'Pay Now', bodyEl);
    docListeners.click?.forEach(fn => {
      fn({ target: payBtn, button: 0 });
    });

    // 2. Simulate window.error with filename AND stack -> extracts function name + breadcrumbs + session_id
    const boomErr = new TypeError(
      'Cannot read amount with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig123',
    );
    boomErr.stack =
      'TypeError: Cannot read amount\n    at submitOrder (https://app.hanzo.ai/components/Checkout.tsx?secret=abc:88:14)';
    windowListeners.error?.forEach(fn => {
      fn({
        error: boomErr,
        message: boomErr.message,
        filename: 'https://app.hanzo.ai/components/Checkout.tsx?secret=abc',
        lineno: 88,
        colno: 14,
      });
    });

    // 3. Simulate console.error with prefix + Error object -> preserves full prefix context
    fakeConsole.error('Payment API failed:', new Error('502 Bad Gateway'));

    // 4. Simulate WCAG live-region alert: existing <div role="alert"> receives a Text node + child <span>
    const liveAlert = makeEl(
      'div',
      { role: 'alert', 'data-component': 'BillingBanner' },
      'Card declined by issuer',
      bodyEl,
    );
    moCallback?.([
      {
        type: 'childList',
        target: liveAlert,
        addedNodes: [{ nodeType: 3, textContent: 'Card declined by issuer' }],
      },
    ]);

    // 5. Simulate non-error role="alert" success toast & explicit data-variant="success" -> MUST NOT be captured!
    const successToast = makeEl('div', { role: 'alert' }, 'Saved successfully', bodyEl);
    const successVariant = makeEl(
      'div',
      { role: 'alert', 'data-variant': 'success' },
      'Error count cleared',
      bodyEl,
    );
    const maskedWrap = makeEl('div', { 'data-hanzo-mask': '' }, '', bodyEl);
    const maskedErr = makeEl('div', { 'data-hanzo-error': '' }, 'Secret failure token', maskedWrap);
    moCallback?.([
      { type: 'childList', target: bodyEl, addedNodes: [successToast, successVariant, maskedErr] },
    ]);

    // 6. Navigate to excluded payment route -> error MUST be suppressed!
    fakeHistory.pushState({}, '', '/pay/confirm/card');
    fakeConsole.error('Card processing error on excluded route');

    const exceptions = sent
      .filter(s => s.body?.payload?.name === '$exception')
      .map(s => s.body.payload.data);

    expect(exceptions).toHaveLength(3);

    // Verify window_error payload
    expect(exceptions[0]).toMatchObject({
      error_source: 'window_error',
      error_class: 'TypeError',
      file: 'https://app.hanzo.ai/components/Checkout.tsx',
      line: 88,
      function: 'submitOrder',
    });
    expect(exceptions[0].message).toContain('[redacted]');
    expect(exceptions[0].message).not.toContain('eyJhbGci');
    expect(exceptions[0].session_id).toMatch(/^hzs_/);
    expect(exceptions[0].$session_id).toBe(exceptions[0].session_id);
    expect(exceptions[0].breadcrumbs).toContain('route:/checkout');
    expect(exceptions[0].breadcrumbs).toContain('click:pay-now-btn');

    // Verify console_error preserved prefix + error message
    expect(exceptions[1]).toMatchObject({
      error_source: 'console_error',
      message: 'Payment API failed: 502 Bad Gateway',
    });

    // Verify WCAG live-region ui_error_message was captured while success/masked/excluded were ignored
    expect(exceptions[2]).toMatchObject({
      error_source: 'ui_error_message',
      error_class: 'UIErrorMessage',
      message: 'Card declined by issuer',
    });
    expect(exceptions[2].component_path).toContain('BillingBanner');

    // Without data-event-key, no /v1/event bridge requests are emitted
    expect(sent.filter(s => s.url.includes('/v1/event'))).toHaveLength(0);
  });

  test('bridges captured session errors and UI error messages to /v1/event when data-event-key is set and refuses sk- keys', () => {
    const trackerPath = join(process.cwd(), 'src/tracker/index.js');
    const src = readFileSync(trackerPath, 'utf8');
    const runnable = src
      .replace('__COLLECT_API_HOST__', '')
      .replace('__COLLECT_API_ENDPOINT__', '/v1/send');

    const runTracker = (scriptAttrs: Record<string, string>) => {
      const sent: Array<{ url: string; init: any; body: any }> = [];
      const storage = new Map<string, string>();
      const sessionStore = new Map<string, string>();
      const makeStorage = (m: Map<string, string>) => ({
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => m.set(k, v),
      });
      const makeEl = (tag: string, attrs: Record<string, string> = {}, text = '', parent?: any) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          nodeType: 1,
          textContent: text,
          parentElement: parent ?? null,
          getAttribute: (k: string) => attrs[k] ?? null,
          hasAttribute: (k: string) => k in attrs,
          getAttributeNames: () => Object.keys(attrs),
          matches: (sel: string) =>
            sel.split(',').some(s => {
              const t = s.trim();
              if (t === '[role="alert"]') return attrs.role === 'alert';
              if (t === '[data-hanzo-error]') return 'data-hanzo-error' in attrs;
              if (t === '[data-error-message]') return 'data-error-message' in attrs;
              return false;
            }),
          closest: (sel: string) => {
            let cur: any = el;
            while (cur) {
              if (cur.matches?.(sel)) return cur;
              cur = cur.parentElement;
            }
            return null;
          },
          querySelectorAll: () => [],
        };
        return el;
      };

      const windowListeners: Record<string, Array<(e: any) => void>> = {};
      let moCallback: ((mutations: any[]) => void) | null = null;
      class FakeMutationObserver {
        constructor(cb: (mutations: any[]) => void) {
          moCallback = cb;
        }
        observe() {}
        disconnect() {}
      }

      const scriptEl = makeEl('script', {
        'data-website-id': 'site-123',
        'data-host-url': 'https://analytics.hanzo.ai',
        'data-release': 'v2.4.0',
        ...scriptAttrs,
      });
      const bodyEl = makeEl('body');
      const fakeConsole = { error: jest.fn() };
      const fakeWindow: any = {
        screen: { width: 1440, height: 900 },
        innerWidth: 1440,
        innerHeight: 900,
        navigator: { language: 'en-US', doNotTrack: null, msDoNotTrack: null },
        location: {
          hostname: 'app.hanzo.ai',
          href: 'https://app.hanzo.ai/checkout',
          origin: 'https://app.hanzo.ai',
        },
        document: {
          currentScript: Object.assign(scriptEl, { src: 'https://analytics.hanzo.ai/script.js' }),
          referrer: '',
          title: 'Checkout',
          readyState: 'complete',
          body: bodyEl,
          documentElement: { scrollHeight: 1200, scrollTop: 0 },
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener: () => {},
        },
        history: { pushState: jest.fn(), replaceState: jest.fn() },
        localStorage: makeStorage(storage),
        sessionStorage: makeStorage(sessionStore),
        addEventListener: (ev: string, fn: any) => {
          if (!windowListeners[ev]) windowListeners[ev] = [];
          windowListeners[ev].push(fn);
        },
        requestAnimationFrame: (fn: any) => fn(),
      };
      fakeWindow.top = fakeWindow;

      const fakeFetch = (url: string, init: any) => {
        sent.push({ url, init, body: JSON.parse(init.body) });
        return Promise.resolve({ json: async () => ({ cache: 'tok' }) });
      };

      const runner = new Function(
        'window',
        'fetch',
        'MutationObserver',
        'console',
        'setTimeout',
        runnable,
      );
      runner(fakeWindow, fakeFetch, FakeMutationObserver, fakeConsole, () => 0);

      // Emit both a window.error with a vendor event.filename + app stack frame and a UI error message
      const err = new TypeError('Cannot read total');
      err.stack =
        'TypeError: Cannot read total\n    at invoke (https://app.hanzo.ai/node_modules/react-dom/index.js:10:2)\n    at calcTotal (https://app.hanzo.ai/components/Cart.tsx:42:9)';
      windowListeners.error?.forEach(fn => {
        fn({
          error: err,
          message: err.message,
          filename: 'https://app.hanzo.ai/node_modules/react-dom/index.js',
          lineno: 10,
          colno: 2,
        });
      });

      const alertEl = makeEl(
        'div',
        { role: 'alert', 'data-component': 'CheckoutBanner' },
        'Payment failed: 502 Bad Gateway',
        bodyEl,
      );
      moCallback?.([{ type: 'childList', target: bodyEl, addedNodes: [alertEl] }]);

      return sent.filter(s => s.url.includes('/v1/event'));
    };

    // 1. Publishable pk- key bridges via ?ingest_key= with CORS-simple text/plain CaptureBatch
    const pkCalls = runTracker({
      'data-event-key': 'pk-live-abc123',
      'data-event-host': 'https://api.hanzo.ai/',
      'data-product': 'app',
      'data-environment': 'production',
    });
    expect(pkCalls).toHaveLength(2);
    expect(pkCalls[0].url).toBe('https://api.hanzo.ai/v1/event?ingest_key=pk-live-abc123');
    expect(pkCalls[0].init.headers['Content-Type']).toBe('text/plain');
    expect(pkCalls[0].init.credentials).toBe('omit');
    expect(pkCalls[0].body.batch).toHaveLength(1);
    expect(pkCalls[0].body.batch[0]).toMatchObject({
      type: 'error',
      url: 'https://app.hanzo.ai/checkout',
      path: '/checkout',
      site: 'app.hanzo.ai',
      release: 'v2.4.0',
      product: 'app',
      environment: 'production',
      level: 'error',
      library: '@hanzo/analytics',
      error: {
        type: 'TypeError',
        message: 'Cannot read total',
        handled: false,
        frames: [
          {
            function: 'calcTotal',
            file: 'https://app.hanzo.ai/components/Cart.tsx',
            line: 42,
            column: 9,
          },
        ],
      },
      properties: {
        hostname: 'app.hanzo.ai',
        route_template: '/checkout',
        error_source: 'window_error',
      },
    });
    expect(pkCalls[0].body.batch[0].sessionId).toMatch(/^hzs_/);

    // UI error message also bridges cleanly with component_path & sessionId
    expect(pkCalls[1].body.batch[0]).toMatchObject({
      type: 'error',
      error: {
        type: 'UIErrorMessage',
        message: 'Payment failed: 502 Bad Gateway',
        handled: false,
      },
      properties: {
        error_source: 'ui_error_message',
        component_path: 'div[CheckoutBanner]',
      },
    });

    // 2. Project key without pk- prefix uses ?api_key=
    const projCalls = runTracker({
      'data-event-key': 'proj_key_999',
      'data-event-host': 'https://api.hanzo.ai',
    });
    expect(projCalls).toHaveLength(2);
    expect(projCalls[0].url).toBe('https://api.hanzo.ai/v1/event?api_key=proj_key_999');

    // 3. Secret sk- and sk_ keys are refused client-side (never transmitted in URL or fetch)
    const skCalls = runTracker({
      'data-event-key': 'sk-live-never-send',
      'data-event-host': 'https://api.hanzo.ai',
    });
    expect(skCalls).toHaveLength(0);
    const skUnderscoreCalls = runTracker({
      'data-event-key': 'sk_live_never_send',
      'data-event-host': 'https://api.hanzo.ai',
    });
    expect(skUnderscoreCalls).toHaveLength(0);

    // 4. $exception payload includes Insights-native $exception_list & shares $insert_id with /v1/event messageId
    expect(pkCalls[0].body.batch[0].messageId).toMatch(/^err_/);
  });

  test('emits Insights-native $exception_list, $exception_fingerprint, and shared $insert_id', () => {
    const src = readFileSync(join(process.cwd(), 'src/tracker/index.js'), 'utf8');
    expect(src).toContain('$exception_list: [exceptionEntry]');
    expect(src).toContain('$exception_fingerprint: fingerprint');
    expect(src).toContain("$exception_level: 'error'");
    expect(src).toContain("messageId: errData.$insert_id || genId('err')");
    const nextCfg = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');
    expect(nextCfg).toContain('max-age=300, stale-while-revalidate=60');
  });
});

describe('Per-session error grouping and UI error message fingerprinting', () => {
  test('differentiates distinct UI error messages on the same route and groups affected sessions', () => {
    const grouped = groupSessionErrors([
      {
        error_class: 'UIErrorMessage',
        error_source: 'ui_error_message',
        message: 'Card declined by issuer 4021',
        route_template: '/checkout',
        hostname: 'app.hanzo.ai',
        release: 'v2.0.0',
        session_id: 'hzs_s1',
        breadcrumbs: 'route:/pricing -> click:checkout',
      },
      {
        error_class: 'UIErrorMessage',
        error_source: 'ui_error_message',
        message: 'Card declined by issuer 9982',
        route_template: '/checkout',
        hostname: 'app.hanzo.ai',
        release: 'v2.0.0',
        session_id: 'hzs_s2',
        breadcrumbs: 'route:/checkout -> click:pay',
      },
      {
        error_class: 'UIErrorMessage',
        error_source: 'ui_error_message',
        message: 'Shipping address is invalid',
        route_template: '/checkout',
        hostname: 'app.hanzo.ai',
        release: 'v2.0.0',
        session_id: 'hzs_s1',
      },
    ]);

    expect(grouped).toHaveLength(2);
    // Numeric IDs normalize into the same issue across sessions s1 and s2
    expect(grouped[0]).toMatchObject({
      repo: 'hanzo-inc/app',
      occurrences: 2,
      session_count: 2,
      sessions: ['hzs_s1', 'hzs_s2'],
      error_sources: ['ui_error_message'],
    });
    // Distinct error message on the same route gets its own separate issue
    expect(grouped[1]).toMatchObject({
      repo: 'hanzo-inc/app',
      occurrences: 1,
      session_count: 1,
      sessions: ['hzs_s1'],
    });
    expect(grouped[0].fingerprint).not.toBe(grouped[1].fingerprint);
  });

  test('POST /v1/journeys returns session_error_issues with per-session grouping', async () => {
    const res = await postJourneys(
      post('https://analytics.hanzo.ai/v1/journeys', {
        steps: [{ session_id: 'hzs_1', step: 'checkout', step_index: 1 }],
        rootStep: 'checkout',
        errors: [
          {
            error_class: 'ConsoleError',
            error_source: 'console_error',
            message: 'Hydration failed on billing widget',
            hostname: 'app.hanzo.ai',
            route_template: '/billing',
            session_id: 'hzs_1',
            breadcrumbs: 'route:/billing',
          },
          {
            error_class: 'ConsoleError',
            error_source: 'console_error',
            message: 'Hydration failed on billing widget',
            hostname: 'app.hanzo.ai',
            route_template: '/billing',
            session_id: 'hzs_2',
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_error_issues).toHaveLength(1);
    expect(body.session_error_issues[0]).toMatchObject({
      repo: 'hanzo-inc/app',
      occurrences: 2,
      session_count: 2,
      sessions: ['hzs_1', 'hzs_2'],
      error_sources: ['console_error'],
      latest_breadcrumbs: 'route:/billing',
    });
  });
});
