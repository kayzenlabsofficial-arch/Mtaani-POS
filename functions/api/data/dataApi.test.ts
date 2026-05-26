import { describe, expect, it } from 'vitest';
import { onRequest } from './[[table]]';

describe('generic data API command-only tables', () => {
  function contextFor(request: Request) {
    return {
      request,
      env: { API_SECRET: 'secret', DB: {} as D1Database },
      params: { table: ['salesTills'] },
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      next: async () => new Response(null),
      data: {},
      functionPath: '/api/data/[[table]]',
    } as any;
  }

  it('rejects generic sales till writes', async () => {
    const response = await onRequest(contextFor(
      new Request('https://smart-pos.test/api/data/salesTills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'secret',
          'X-Business-ID': 'biz-1',
        },
        body: JSON.stringify({ id: 'till-1', name: 'Till 1' }),
      }),
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Sales tills must use the business settings API.',
    });
  });

  it('rejects generic sales till deletes', async () => {
    const response = await onRequest(contextFor(
      new Request('https://smart-pos.test/api/data/salesTills', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'secret',
          'X-Business-ID': 'biz-1',
        },
        body: JSON.stringify({ id: 'till-1' }),
      }),
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Sales tills cannot be deleted from the generic data API.',
    });
  });
});
