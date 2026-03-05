import { test, expect } from '@playwright/test';

test.describe('create game', () => {
  test('POST /api/game returns a game ID and a unique 6-character alphanumeric join code', async ({
    request,
  }) => {
    const response = await request.post('/api/game', {
      data: { storytellerId: 'test-st-1' },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.gameId).toBeTruthy();
    expect(typeof body.gameId).toBe('string');
    expect(body.joinCode).toBeTruthy();
    expect(body.joinCode).toHaveLength(6);
    expect(/^[A-HJ-NP-Z2-9]+$/.test(body.joinCode)).toBe(true);
  });

  test('join code is unique across multiple game creations', async ({ request }) => {
    const codes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const response = await request.post('/api/game', {
        data: { storytellerId: `st-${i}` },
      });
      const body = await response.json();
      expect(codes.has(body.joinCode)).toBe(false);
      codes.add(body.joinCode);
    }
  });

  test('response includes WebSocket connection URL for the host', async ({ request }) => {
    const response = await request.post('/api/game', {
      data: { storytellerId: 'test-st-ws' },
    });
    const body = await response.json();
    expect(body.wsUrl).toBeTruthy();
    expect(typeof body.wsUrl).toBe('string');
    expect(body.wsUrl).toMatch(/^wss?:\/\/.+/);
  });
});
