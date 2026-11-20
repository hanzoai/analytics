jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    client: {
      websiteEvent: { create: jest.fn().mockResolvedValue({}) },
    },
  },
}));
jest.mock('@/queries/sql/events/saveEventData', () => ({
  saveEventData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/queries/sql/events/saveRevenue', () => ({
  saveRevenue: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/datastore', () => ({
  __esModule: true,
  default: { enabled: false },
}));
jest.mock('@/lib/kafka', () => ({
  __esModule: true,
  default: { enabled: false },
}));

import { POST as postElement } from '@/app/v1/element/route';
import { saveEvent } from '@/queries/sql/events/saveEvent';
import { saveRevenue } from '@/queries/sql/events/saveRevenue';

const saveRevenueMock = saveRevenue as jest.Mock;

describe('Server-only payment attribution & route guards integration', () => {
  const prevDbUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  });

  afterAll(() => {
    if (prevDbUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = prevDbUrl;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('saveEvent NEVER writes revenue for client-redirect checkout_completed', async () => {
    await saveEvent({
      websiteId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
      visitId: '33333333-3333-4333-8333-333333333333',
      eventType: 2,
      urlPath: '/pay/confirm/card',
      eventName: 'checkout_completed',
      eventData: {
        confirmed_by: 'client_redirect',
        outcome: 'completed',
        revenue: 149,
        currency: 'USD',
      },
    });

    expect(saveRevenueMock).not.toHaveBeenCalled();
  });

  test('saveEvent writes revenue ONLY for confirmed server checkout_completed events', async () => {
    await saveEvent({
      websiteId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
      visitId: '33333333-3333-4333-8333-333333333333',
      eventType: 2,
      urlPath: '/pay/confirm/card',
      eventName: 'checkout_completed',
      eventData: {
        confirmed_by: 'server',
        confirmation_source: 'stripe_webhook',
        outcome: 'completed',
        revenue: 149,
        currency: 'USD',
      },
    });

    expect(saveRevenueMock).toHaveBeenCalledTimes(1);
    expect(saveRevenueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'checkout_completed',
        revenue: 149,
        currency: 'USD',
      }),
    );
  });

  test('POST /v1/element drops /auth/callback and /pay/confirm/* and returns aggregate key on eligible routes', async () => {
    const authRes = await postElement(
      new Request('https://analytics.hanzo.ai/v1/element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: 'hanzo.app',
          url: '/auth/callback?code=secret',
          control_id: 'callback-btn',
        }),
      }),
    );
    const authJson = await authRes.json();
    expect(authJson).toEqual({ ok: true, dropped: true, reason: 'excluded_route' });

    const payRes = await postElement(
      new Request('https://analytics.hanzo.ai/v1/element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: 'hanzo.app',
          url: '/pay/confirm/card',
          control_id: 'confirm-pay',
        }),
      }),
    );
    expect(await payRes.json()).toEqual({ ok: true, dropped: true, reason: 'excluded_route' });

    const eligibleRes = await postElement(
      new Request('https://analytics.hanzo.ai/v1/element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: 'platform.hanzo.ai',
          url: '/dev/my-agent-project',
          release: '2026.11.20',
          viewportWidth: 1440,
          control_id: 'deploy-agent',
        }),
      }),
    );
    expect(await eligibleRes.json()).toEqual({
      ok: true,
      key: {
        hostname: 'platform.hanzo.ai',
        route_template: '/dev/:project',
        release: '2026.11.20',
        viewport: 'desktop',
        control_id: 'deploy-agent',
      },
    });
  });
});
