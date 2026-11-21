import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST } from '@/app/v1/ast/route';

describe('AST route and default-on component journey tracker', () => {
  test('POST /v1/ast drops excluded auth and payment routes before processing', async () => {
    for (const url of [
      'https://hanzo.ai/auth/callback?code=secret',
      'https://hanzo.ai/pay/confirm/stripe',
      'https://hanzo.ai/pay/card/123',
      'https://hanzo.ai/checkout/payment/abc',
    ]) {
      const req = new Request('https://analytics.hanzo.ai/v1/ast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, sections: [{ name: 'hero', type: 'section', content: [] }] }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, dropped: true, reason: 'excluded_ux_route' });
    }
  });

  test('POST /v1/ast accepts eligible page AST and returns normalized route template', async () => {
    const req = new Request('https://analytics.hanzo.ai/v1/ast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://hanzo.app/dev/my-solar-app/42',
        sections: [
          {
            name: 'composer',
            type: 'section',
            content: [{ type: 'button', text: 'Send', control_id: 'composer-send' }],
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      hostname: 'hanzo.app',
      route_template: '/dev/:project/:id',
      sections: 1,
    });
  });

  test('tracker/index.js enables AST by default and records component_path + step_index', () => {
    const src = readFileSync(join(process.cwd(), 'src/tracker/index.js'), 'utf8');
    expect(src).toContain('const astEnabled = attr(`${_data}ast`) !== _false;');
    expect(src).toContain('resolveComponentPath');
    expect(src).toContain('nextJourneyStep');
    expect(src).toContain('component_path: componentPath || undefined');
    expect(src).toContain('step_index: stepIndex');
  });
});
