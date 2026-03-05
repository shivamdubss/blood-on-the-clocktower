import { test, expect } from '@playwright/test';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

const BASE_URL = 'http://localhost:3000';

function createSocket(): ClientSocket {
  return ioClient(BASE_URL, { forceNew: true, transports: ['websocket'] });
}

function waitFor(socket: ClientSocket, event: string, timeout = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

test.describe('lobby start', () => {
  test('host can start game with 5+ players', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    // Host connects and claims host role via hostSecret
    const host = createSocket();
    await waitFor(host, 'connect');

    const sockets: ClientSocket[] = [host];
    host.emit('join_game', { joinCode, playerName: 'Host', hostSecret });
    await waitFor(host, 'game_joined');

    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `Player${i}` });
      await waitFor(s, 'game_joined');
      sockets.push(s);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // All 5 clients listen for game_started
    const startedPromises = sockets.map((s) => waitFor(s, 'game_started'));
    host.emit('start_game', { gameId });

    const results = await Promise.all(startedPromises);
    for (const r of results) {
      expect((r as { gameId: string }).gameId).toBe(gameId);
    }

    // Cleanup
    for (const s of sockets) s.disconnect();
  });

  test('cannot start with fewer than 5 players', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host', hostSecret });
    await waitFor(host, 'game_joined');

    // Try to start with 1 player
    const errPromise = waitFor(host, 'start_error');
    host.emit('start_game', { gameId });
    const err = (await errPromise) as { message: string };
    expect(err.message).toBe('Player count must be between 5 and 15');

    host.disconnect();
  });

  test('player disconnect removes them from lobby', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host' });
    await waitFor(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const player = createSocket();
    await waitFor(player, 'connect');
    player.emit('join_game', { joinCode, playerName: 'Alice' });
    await waitFor(player, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Set up both listeners BEFORE triggering disconnect to avoid race
    const leftPromise = waitFor(host, 'player_left');
    const statePromise = waitFor(host, 'game_state');
    player.disconnect();

    const leftData = (await leftPromise) as { playerId: string };
    expect(leftData.playerId).toBeTruthy();

    const state = (await statePromise) as { players: { name: string }[] };
    expect(state.players).toHaveLength(1);
    expect(state.players[0].name).toBe('Host');

    host.disconnect();
  });
});
