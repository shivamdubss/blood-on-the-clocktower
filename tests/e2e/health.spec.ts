import { test, expect } from '@playwright/test';

test('health check returns 200 with status ok', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.status).toBe('ok');
});

test('POST /api/game creates a game with join code', async ({ request }) => {
  const response = await request.post('/api/game', {
    data: { storytellerId: 'test-storyteller' },
  });
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.gameId).toBeTruthy();
  expect(body.joinCode).toBeTruthy();
  expect(body.joinCode).toHaveLength(6);
});
