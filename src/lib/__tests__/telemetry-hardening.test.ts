import {
  AUTH_CALLBACK_CANONICAL_ROUTE,
  AUTH_CALLBACK_OUTCOME_EVENT,
  authCallbackOutcomeSchema,
  buildAuthCallbackOutcome,
} from '@/lib/auth-telemetry';
import {
  buildFunnelStepEvent,
  classifyDeviceClass,
  computeConfirmedPaymentMetrics,
  enforceServerPaymentTrustBoundary,
  funnelStepEventSchema,
  isConfirmedServerPaymentEvent,
  isTrustedServerEventRequest,
  normalizeRouteTemplate,
} from '@/lib/funnel';
import {
  aggregateHeatmapInteractions,
  buildAggregateHeatmapKey,
  isHeatmapEligibleRoute,
  resolveStableControlId,
} from '@/lib/heatmap';
import {
  decorateCrossDomainUrl,
  extractCrossDomainIdentity,
  HANZO_ECOSYSTEM_DOMAINS,
  isHanzoEcosystemHost,
  resolveCanonicalVisitorId,
  stitchActivationJourneys,
} from '@/lib/identity';
import {
  buildPreCaptureMaskingConfig,
  classifyRouteTelemetry,
  isSensitiveDomElement,
  isSensitiveInputDescriptor,
  isUxCaptureExcludedRoute,
  MASKED_PLACEHOLDER,
  maskInputBeforeCapture,
  maskTextBeforeCapture,
  SENSITIVE_MASK_TEXT_SELECTOR,
  sanitizeReplayChunkBeforeStorage,
  stripSensitiveUrlParams,
} from '@/lib/privacy';

describe('P0 #3: Funnel Step Event Contract', () => {
  test('normalizes dynamic routes to bounded route templates', () => {
    expect(normalizeRouteTemplate('/pay/confirm/card?session_id=cs_123')).toBe(
      '/pay/confirm/:method',
    );
    expect(normalizeRouteTemplate('/pay/confirm/apple-pay')).toBe('/pay/confirm/:method');
    expect(normalizeRouteTemplate('https://hanzo.app/dev/my-ai-project')).toBe('/dev/:project');
    expect(normalizeRouteTemplate('/dev/my-ai-project/settings')).toBe('/dev/:project/settings');
    expect(normalizeRouteTemplate('/projects/acme-prod/deployments/42')).toBe(
      '/projects/:project/deployments/:id',
    );
    expect(normalizeRouteTemplate('/orders/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/orders/:id',
    );
    expect(normalizeRouteTemplate('/pay/card/pm_12345678')).toBe('/pay/card/:id');
    expect(normalizeRouteTemplate('/checkout/payment/cs_test_9999')).toBe('/checkout/payment/:id');
    expect(normalizeRouteTemplate('/auth/callback?code=secret&state=xyz')).toBe('/auth/callback');
  });

  test('classifies device_class into mobile | tablet | desktop', () => {
    expect(classifyDeviceClass({ width: 390 })).toBe('mobile');
    expect(classifyDeviceClass({ width: 834 })).toBe('tablet');
    expect(classifyDeviceClass({ width: 1440 })).toBe('desktop');
    expect(classifyDeviceClass({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe(
      'mobile',
    );
    expect(classifyDeviceClass({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' })).toBe('tablet');
    expect(classifyDeviceClass({ device: 'laptop' })).toBe('desktop');
  });

  test('builds and validates funnel step contract with required fields', () => {
    const event = buildFunnelStepEvent({
      hostname: 'https://Platform.Hanzo.AI',
      route: '/dev/my-saas-app?utm_source=twitter',
      release: '2026.11.20-abc123',
      viewportWidth: 1280,
      outcome: 'started',
      step: 'workspace_created',
    });

    expect(event).toEqual({
      hostname: 'platform.hanzo.ai',
      route: '/dev/:project',
      release: '2026.11.20-abc123',
      device_class: 'desktop',
      outcome: 'started',
      step: 'workspace_created',
    });

    for (const outcome of ['started', 'completed', 'canceled', 'failed'] as const) {
      expect(
        funnelStepEventSchema.safeParse({
          hostname: 'hanzo.app',
          route: '/pay/confirm/:method',
          release: '1.0.0',
          device_class: 'mobile',
          outcome,
        }).success,
      ).toBe(true);
    }

    expect(
      funnelStepEventSchema.safeParse({
        hostname: 'hanzo.app',
        route: '/pay/confirm/:method',
        release: '1.0.0',
        device_class: 'watch',
        outcome: 'completed',
      }).success,
    ).toBe(false);

    expect(
      funnelStepEventSchema.safeParse({
        hostname: 'hanzo.app',
        route: '/pay/confirm/:method',
        release: '1.0.0',
        device_class: 'desktop',
        outcome: 'unknown_outcome',
      }).success,
    ).toBe(false);
  });
});

describe('P0 #3: Confirmed Server-Side Payment Attribution', () => {
  test('counts ONLY checkout_completed with confirmed_by=server and rejects client redirects', () => {
    // Valid S2S webhook payment
    expect(
      isConfirmedServerPaymentEvent('checkout_completed', {
        confirmed_by: 'server',
        confirmation_source: 'stripe_webhook',
        outcome: 'completed',
        revenue: 49,
        currency: 'USD',
      }),
    ).toBe(true);

    // Client-redirect alone must NEVER be counted
    expect(
      isConfirmedServerPaymentEvent('checkout_completed', {
        confirmed_by: 'client',
        outcome: 'completed',
        revenue: 49,
        currency: 'USD',
      }),
    ).toBe(false);

    expect(
      isConfirmedServerPaymentEvent('checkout_completed', {
        confirmed_by: 'client_redirect',
        outcome: 'completed',
        revenue: 49,
        currency: 'USD',
      }),
    ).toBe(false);

    expect(
      isConfirmedServerPaymentEvent('checkout_completed', {
        source: 'client_redirect',
        confirmed_by: 'server',
        outcome: 'completed',
        revenue: 49,
        currency: 'USD',
      }),
    ).toBe(false);

    // Missing confirmed_by must NEVER be counted
    expect(
      isConfirmedServerPaymentEvent('checkout_completed', {
        outcome: 'completed',
        revenue: 49,
        currency: 'USD',
      }),
    ).toBe(false);

    // Failed/canceled server event must NEVER be counted as payment success
    expect(
      isConfirmedServerPaymentEvent('checkout_completed', {
        confirmed_by: 'server',
        confirmation_source: 'webhook',
        outcome: 'failed',
        revenue: 49,
        currency: 'USD',
      }),
    ).toBe(false);

    // Wrong event name must NEVER be counted
    expect(
      isConfirmedServerPaymentEvent('checkout_redirect_return', {
        confirmed_by: 'server',
        revenue: 49,
        currency: 'USD',
      }),
    ).toBe(false);
  });

  test('computes payment success metrics counting only server-confirmed events', () => {
    const metrics = computeConfirmedPaymentMetrics([
      {
        eventName: 'checkout_completed',
        visitorId: 'vis-1',
        eventData: {
          confirmed_by: 'client_redirect',
          outcome: 'completed',
          revenue: 99,
          currency: 'USD',
        },
      },
      {
        eventName: 'checkout_completed',
        visitorId: 'vis-1',
        eventData: { confirmed_by: 'client', outcome: 'completed', revenue: 99, currency: 'USD' },
      },
      {
        eventName: 'checkout_completed',
        visitorId: 'vis-1',
        eventData: {
          confirmed_by: 'server',
          confirmation_source: 'commerce_webhook',
          outcome: 'completed',
          revenue: 99,
          currency: 'USD',
        },
      },
      {
        eventName: 'checkout_completed',
        visitorId: 'vis-2',
        eventData: { confirmed_by: 'server', outcome: 'canceled', revenue: 49, currency: 'USD' },
      },
    ]);

    expect(metrics.confirmedCount).toBe(1);
    expect(metrics.rejectedUnconfirmedCount).toBe(3);
    expect(metrics.confirmedVisitorIds).toEqual(['vis-1']);
    expect(metrics.revenueByCurrency).toEqual({ USD: 99 });
  });

  test('enforces S2S trust boundary against forged browser confirmed_by=server claims', () => {
    const prevSecret = process.env.ANALYTICS_S2S_SECRET;
    process.env.ANALYTICS_S2S_SECRET = 'test-s2s-secret-xyz';

    try {
      const browserReq = new Request('https://analytics.hanzo.ai/v1/send', {
        method: 'POST',
        headers: { origin: 'https://hanzo.app', 'sec-fetch-mode': 'cors' },
      });
      expect(isTrustedServerEventRequest(browserReq)).toBe(false);

      const downgraded = enforceServerPaymentTrustBoundary(
        'checkout_completed',
        { confirmed_by: 'server', outcome: 'completed', revenue: 50, currency: 'USD' },
        isTrustedServerEventRequest(browserReq),
      );
      expect(downgraded?.confirmed_by).toBe('client_unverified');
      expect(isConfirmedServerPaymentEvent('checkout_completed', downgraded)).toBe(false);

      const s2sReq = new Request('https://analytics.hanzo.ai/v1/send', {
        method: 'POST',
        headers: { 'x-hanzo-s2s-secret': 'test-s2s-secret-xyz' },
      });
      expect(isTrustedServerEventRequest(s2sReq)).toBe(true);

      const trusted = enforceServerPaymentTrustBoundary(
        'checkout_completed',
        {
          confirmed_by: 'server',
          confirmation_source: 'webhook',
          outcome: 'completed',
          revenue: 50,
          currency: 'USD',
        },
        isTrustedServerEventRequest(s2sReq),
      );
      expect(trusted?.confirmed_by).toBe('server');
      expect(isConfirmedServerPaymentEvent('checkout_completed', trusted)).toBe(true);
    } finally {
      if (prevSecret === undefined) {
        delete process.env.ANALYTICS_S2S_SECRET;
      } else {
        process.env.ANALYTICS_S2S_SECRET = prevSecret;
      }
    }
  });
});

describe('P0 #3: Cross-Domain Identity Stitching', () => {
  test('links one customer across hanzo.ai -> hanzo.app -> hanzo.bot -> hanzo.team -> platform.hanzo.ai', () => {
    const baseIdentity = {
      hz_aid: 'hza_customer_001',
      hz_sid: 'hzs_session_001',
      visitor_id: 'vis_customer_001',
    };

    // Verify all 5 ecosystem domains are recognized and external domains are excluded
    for (const host of HANZO_ECOSYSTEM_DOMAINS) {
      expect(isHanzoEcosystemHost(host)).toBe(true);
    }
    expect(isHanzoEcosystemHost('evil.example.com')).toBe(false);

    // Decorate each cross-domain hop and verify extraction preserves identity
    const hopUrls = [
      'https://hanzo.app/signup',
      'https://hanzo.bot/agents/new',
      'https://hanzo.team/invite',
      'https://platform.hanzo.ai/dev/my-first-app',
    ];

    let currentIdentity = baseIdentity;
    const journeyEvents = [
      {
        hostname: 'hanzo.ai',
        route: '/',
        eventName: 'landing_viewed',
        timestamp: 1000,
        ...currentIdentity,
      },
    ];

    hopUrls.forEach((url, idx) => {
      const decorated = decorateCrossDomainUrl(url, currentIdentity);
      const extracted = extractCrossDomainIdentity(decorated);
      expect(extracted).toEqual(baseIdentity);

      const parsed = new URL(decorated);
      journeyEvents.push({
        hostname: parsed.hostname,
        route: normalizeRouteTemplate(parsed.pathname),
        eventName: `hop_${idx + 1}`,
        timestamp: 2000 + idx * 1000,
        ...extracted,
        // User logs in at hanzo.team and links distinct_id
        ...(parsed.hostname === 'hanzo.team' || parsed.hostname === 'platform.hanzo.ai'
          ? { distinct_id: 'usr_hanzo_42' }
          : {}),
      });
      currentIdentity = {
        hz_aid: extracted.hz_aid ?? '',
        hz_sid: extracted.hz_sid ?? '',
        visitor_id: extracted.visitor_id ?? '',
      };
    });

    // Server-side confirmed payment event arrives on platform.hanzo.ai with only distinct_id + visitor_id
    journeyEvents.push({
      hostname: 'platform.hanzo.ai',
      route: '/pay/confirm/:method',
      eventName: 'checkout_completed',
      timestamp: 9000,
      visitor_id: baseIdentity.visitor_id,
      distinct_id: 'usr_hanzo_42',
      eventData: {
        confirmed_by: 'server',
        confirmation_source: 'stripe_webhook',
        outcome: 'completed',
        revenue: 199,
        currency: 'USD',
      },
    } as any);

    // External URL must NOT receive identity query params
    expect(decorateCrossDomainUrl('https://external-site.com/docs', baseIdentity)).toBe(
      'https://external-site.com/docs',
    );

    expect(
      resolveCanonicalVisitorId({
        visitor_id: baseIdentity.visitor_id,
        hz_aid: baseIdentity.hz_aid,
      }),
    ).toBe('vis_customer_001');

    const stitched = stitchActivationJourneys(journeyEvents);
    expect(stitched).toHaveLength(1);
    expect(stitched[0].hostnames).toEqual([
      'hanzo.ai',
      'hanzo.app',
      'hanzo.bot',
      'hanzo.team',
      'platform.hanzo.ai',
    ]);
    expect(stitched[0].hz_aids).toEqual(['hza_customer_001']);
    expect(stitched[0].hz_sids).toEqual(['hzs_session_001']);
    expect(stitched[0].visitor_ids).toEqual(['vis_customer_001']);
    expect(stitched[0].distinct_ids).toEqual(['usr_hanzo_42']);
    expect(stitched[0].confirmedPaymentCount).toBe(1);
    expect(stitched[0].isActivated).toBe(true);
  });
});

describe('Privacy-First Native DOM Replay: Pre-Capture Masking & Route Exclusion', () => {
  test('excludes all sensitive auth and payment routes before capture', () => {
    const excludedRoutes = [
      '/auth/callback',
      '/auth/callback?code=oauth_secret&state=abc',
      'https://hanzo.app/auth/callback/oidc',
      '/oauth/callback',
      '/oauth/callback?code=123',
      '/login/callback',
      '/pay/confirm/card',
      '/pay/confirm/apple-pay?intent=pi_123',
      '/pay/card/new',
      '/pay/card/pm_12345',
      '/checkout/payment/cs_live_123',
      '/checkout/payment',
    ];

    for (const route of excludedRoutes) {
      expect(isUxCaptureExcludedRoute(route)).toBe(true);
      expect(isHeatmapEligibleRoute(route)).toBe(false);
    }

    const eligibleRoutes = ['/', '/pricing', '/dev/my-app', '/docs/quickstart', '/dashboard'];
    for (const route of eligibleRoutes) {
      expect(isUxCaptureExcludedRoute(route)).toBe(false);
      expect(isHeatmapEligibleRoute(route)).toBe(true);
      expect(classifyRouteTelemetry(route)).toBe('ux_eligible');
    }
  });

  test('masks password, card, cvv, iban, secret, api-key inputs and marked containers before capture', () => {
    const sensitiveInputs = [
      { tagName: 'input', type: 'password' },
      { tagName: 'input', type: 'text', name: 'card_number', autocomplete: 'cc-number' },
      { tagName: 'input', type: 'text', id: 'cvv-input', placeholder: 'CVV' },
      { tagName: 'input', type: 'text', name: 'iban_account' },
      { tagName: 'input', type: 'text', name: 'client_secret' },
      { tagName: 'input', type: 'text', name: 'api_key', id: 'hanzo-api-key' },
      { tagName: 'div', attributes: { 'data-hanzo-mask': '' } },
      { tagName: 'div', attributes: { 'data-conversation-body': 'true' } },
      { tagName: 'section', className: 'chat-panel conversation-body' },
      { tagName: 'span', attributes: { 'data-secret': 'true' } },
    ];

    for (const desc of sensitiveInputs) {
      expect(isSensitiveInputDescriptor(desc)).toBe(true);
      expect(maskInputBeforeCapture('super-secret-value', desc, false)).toBe(MASKED_PLACEHOLDER);
      expect(maskTextBeforeCapture('private conversation message', desc)).toBe(MASKED_PLACEHOLDER);
    }

    // Non-sensitive text remains visible unless strict mode
    const benignButton = { tagName: 'button', textContent: 'Deploy Project' };
    expect(isSensitiveInputDescriptor(benignButton)).toBe(false);
    expect(maskTextBeforeCapture('Deploy Project', benignButton)).toBe('Deploy Project');

    // DOM-like element with closest() matching sensitive container
    const childInsideConversation = {
      tagName: 'p',
      closest: (sel: string) => (sel.includes('.conversation-body') ? {} : null),
    };
    expect(isSensitiveDomElement(childInsideConversation)).toBe(true);
    expect(maskTextBeforeCapture('user prompt text', childInsideConversation)).toBe(
      MASKED_PLACEHOLDER,
    );

    const cfg = buildPreCaptureMaskingConfig('moderate');
    expect(cfg.maskAllInputs).toBe(true);
    expect(cfg.maskTextSelector).toBe(SENSITIVE_MASK_TEXT_SELECTOR);
    expect(cfg.maskInputFn('sk-live-secret', { tagName: 'input', name: 'api_key' })).toBe(
      MASKED_PLACEHOLDER,
    );
  });

  test('sanitizes replay chunks before storage: drops excluded routes & scrubs DOM snapshots', () => {
    const excludedChunk = sanitizeReplayChunkBeforeStorage(
      [
        {
          type: 4,
          timestamp: 1700000000000,
          data: { href: 'https://hanzo.app/auth/callback?code=secret_code&state=123' },
        },
      ],
      '/auth/callback',
    );
    expect(excludedChunk.dropped).toBe(true);
    expect(excludedChunk.reason).toBe('excluded_route');
    expect(excludedChunk.events).toEqual([]);

    const payChunk = sanitizeReplayChunkBeforeStorage([
      {
        type: 4,
        timestamp: 1700000000000,
        data: { href: 'https://hanzo.app/pay/confirm/card' },
      },
    ]);
    expect(payChunk.dropped).toBe(true);
    expect(payChunk.reason).toBe('excluded_route');

    // Eligible route snapshot has sensitive DOM nodes scrubbed
    const scrubbed = sanitizeReplayChunkBeforeStorage(
      [
        {
          type: 4,
          timestamp: 1700000000000,
          data: { href: 'https://hanzo.app/dev/my-project?api_key=sk_live_123&tab=keys' },
        },
        {
          type: 2,
          timestamp: 1700000000100,
          data: {
            node: {
              type: 0,
              childNodes: [
                {
                  type: 2,
                  tagName: 'input',
                  attributes: { type: 'password', value: 'MyP@ssw0rd!' },
                },
                {
                  type: 2,
                  tagName: 'input',
                  attributes: { type: 'text', name: 'cvv', value: '842' },
                },
                {
                  type: 2,
                  tagName: 'div',
                  attributes: { class: 'conversation-body' },
                  childNodes: [{ type: 3, textContent: 'Confidential AI chat transcript' }],
                },
                {
                  type: 2,
                  tagName: 'span',
                  attributes: { 'data-secret': '1' },
                  childNodes: [{ type: 3, textContent: 'hz_live_987654321' }],
                },
                {
                  type: 2,
                  tagName: 'button',
                  attributes: { 'data-control-id': 'deploy-btn' },
                  childNodes: [{ type: 3, textContent: 'Deploy' }],
                },
              ],
            },
          },
        },
      ],
      '/dev/my-project',
    );

    expect(scrubbed.dropped).toBe(false);
    expect(scrubbed.events[0].data.href).toBe('https://hanzo.app/dev/my-project?tab=keys');
    const children = scrubbed.events[1].data.node.childNodes;
    expect(children[0].attributes.value).toBe(MASKED_PLACEHOLDER);
    expect(children[1].attributes.value).toBe(MASKED_PLACEHOLDER);
    expect(children[2].childNodes[0].textContent).toBe(MASKED_PLACEHOLDER);
    expect(children[3].childNodes[0].textContent).toBe(MASKED_PLACEHOLDER);
    // Benign CTA button text is preserved
    expect(children[4].childNodes[0].textContent).toBe('Deploy');

    expect(stripSensitiveUrlParams('https://hanzo.app/auth/callback?code=abc&state=123')).toBe(
      'https://hanzo.app/auth/callback',
    );
  });
});

describe('/auth/callback Operational Telemetry Routing', () => {
  test('routes /auth/callback strictly to auth_callback_outcome, never UX heatmap/replay', () => {
    expect(classifyRouteTelemetry('/auth/callback?code=xyz&state=123')).toBe('auth_operational');
    expect(classifyRouteTelemetry('/oauth/callback')).toBe('auth_operational');
    expect(classifyRouteTelemetry('/login/callback')).toBe('auth_operational');
    expect(isUxCaptureExcludedRoute('/auth/callback')).toBe(true);
    expect(isHeatmapEligibleRoute('/auth/callback')).toBe(false);

    const okTelemetry = buildAuthCallbackOutcome({
      hostname: 'hanzo.app',
      release: '2026.11.20',
      viewportWidth: 1440,
      outcome: 'completed',
      latency_ms: 184.6,
    });

    expect(okTelemetry.event).toBe(AUTH_CALLBACK_OUTCOME_EVENT);
    expect(okTelemetry.channel).toBe('auth_operational');
    expect(okTelemetry.ux_capture_eligible).toBe(false);
    expect(okTelemetry.payload).toEqual({
      hostname: 'hanzo.app',
      route: AUTH_CALLBACK_CANONICAL_ROUTE,
      release: '2026.11.20',
      device_class: 'desktop',
      outcome: 'completed',
      latency_ms: 185,
      error_code: null,
    });

    const errTelemetry = buildAuthCallbackOutcome({
      hostname: 'platform.hanzo.ai',
      release: '2026.11.20',
      viewportWidth: 390,
      outcome: 'failed',
      latency_ms: 412,
      error_code: 'pkce_verifier_mismatch',
    });

    expect(authCallbackOutcomeSchema.safeParse(errTelemetry.payload).success).toBe(true);
    expect(errTelemetry.payload).toEqual({
      hostname: 'platform.hanzo.ai',
      route: '/auth/callback',
      release: '2026.11.20',
      device_class: 'mobile',
      outcome: 'failed',
      latency_ms: 412,
      error_code: 'pkce_verifier_mismatch',
    });
  });
});

describe('Aggregate Heatmaps (Default-On on Eligible Routes)', () => {
  test('keys aggregate heatmaps by { hostname, route_template, release, viewport, control_id }', () => {
    // Stable control_id priority: data-control-id > data-testid > semantic button identifier
    expect(
      resolveStableControlId({
        tagName: 'button',
        attributes: { 'data-control-id': 'cta-start-building', 'data-testid': 'fallback-id' },
        textContent: 'Start Building',
      }),
    ).toBe('cta-start-building');

    expect(
      resolveStableControlId({
        tagName: 'button',
        attributes: { 'data-testid': 'upgrade-pro-btn' },
        textContent: 'Upgrade',
      }),
    ).toBe('upgrade-pro-btn');

    expect(
      resolveStableControlId({
        tagName: 'button',
        textContent: 'Deploy to Cloud',
      }),
    ).toBe('button:deploy-to-cloud');

    // Sensitive elements NEVER produce a heatmap control_id
    expect(
      resolveStableControlId({
        tagName: 'input',
        type: 'password',
        attributes: { 'data-control-id': 'pwd-input' },
      }),
    ).toBeNull();

    expect(
      resolveStableControlId({
        tagName: 'button',
        attributes: { 'data-hanzo-mask': 'true', 'data-control-id': 'reveal-secret' },
      }),
    ).toBeNull();

    // Excluded routes NEVER produce heatmap keys
    expect(
      buildAggregateHeatmapKey({
        hostname: 'hanzo.app',
        urlOrPath: '/auth/callback?code=abc',
        release: '2026.11.20',
        viewportWidth: 1440,
        control_id: 'any-btn',
      }),
    ).toBeNull();

    expect(
      buildAggregateHeatmapKey({
        hostname: 'hanzo.app',
        urlOrPath: '/pay/confirm/card',
        release: '2026.11.20',
        viewportWidth: 1440,
        control_id: 'submit-payment',
      }),
    ).toBeNull();

    // Eligible routes aggregate cleanly across dynamic project slugs
    const buckets = aggregateHeatmapInteractions([
      {
        hostname: 'platform.hanzo.ai',
        urlOrPath: '/dev/project-alpha',
        release: '2026.11.20',
        viewportWidth: 1440,
        element: { tagName: 'button', attributes: { 'data-control-id': 'deploy-btn' } },
      },
      {
        hostname: 'platform.hanzo.ai',
        urlOrPath: '/dev/project-beta',
        release: '2026.11.20',
        viewportWidth: 1280,
        element: { tagName: 'button', attributes: { 'data-control-id': 'deploy-btn' } },
      },
      {
        hostname: 'platform.hanzo.ai',
        urlOrPath: '/dev/project-alpha',
        release: '2026.11.20',
        viewportWidth: 390,
        element: { tagName: 'button', attributes: { 'data-control-id': 'deploy-btn' } },
      },
      // Excluded route click is silently dropped
      {
        hostname: 'platform.hanzo.ai',
        urlOrPath: '/auth/callback',
        release: '2026.11.20',
        viewportWidth: 1440,
        control_id: 'callback-spinner',
      },
    ]);

    expect(buckets).toEqual([
      {
        key: {
          hostname: 'platform.hanzo.ai',
          route_template: '/dev/:project',
          release: '2026.11.20',
          viewport: 'desktop',
          control_id: 'deploy-btn',
        },
        count: 2,
      },
      {
        key: {
          hostname: 'platform.hanzo.ai',
          route_template: '/dev/:project',
          release: '2026.11.20',
          viewport: 'mobile',
          control_id: 'deploy-btn',
        },
        count: 1,
      },
    ]);
  });
});
