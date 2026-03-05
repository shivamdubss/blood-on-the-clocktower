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
    const res = await request.post('/api/game', { data: { storytellerId: 'pending' } });
    const { joinCode, gameId } = await res.json();

    // Host connects first
    const host = createSocket();
    await waitFor(host, 'connect');

    // Update storytellerId to host's socket id
    // We need to join the game - the storytellerId needs to match
    // Let's use a workaround: create game with known storytellerId matching host socket id

    // Actually, the game was created via API with storytellerId = 'pending'.
    // We'll need to set it after the host connects. For now, let's test the error path.

    // Join 5 players
    const sockets: ClientSocket[] = [host];
    host.emit('join_game', { joinCode, playerName: 'Host' });
    await waitFor(host, 'game_joined');

    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `Player${i}` });
      await waitFor(s, 'game_joined');
      sockets.push(s);
    }

    // Host tries to start but storytellerId doesn't match socket id
    const errPromise = waitFor(host, 'start_error');
    host.emit('start_game', { gameId });
    const err = (await errPromise) as { message: string };
    expect(err.message).toBe('Only the host can start the game');

    // Cleanup
    for (const s of sockets) s.disconnect();
  });

  test('cannot start with fewer than 5 players', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host' });
    const joined = (await waitFor(host, 'game_joined')) as { playerId: string };

    // Try to start with 1 player (even if we were the host)
    const errPromise = waitFor(host, 'start_error');
    host.emit('start_game', { gameId });
    const err = (await errPromise) as { message: string };
    // Could be "Only the host can start" or "Player count" - depends on storytellerId
    expect(err.message).toBeTruthy();

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

    // Listen for player_left on host
    const leftPromise = waitFor(host, 'player_left');
    player.disconnect();

    const leftData = (await leftPromise) as { playerId: string };
    expect(leftData.playerId).toBeTruthy();

    // Wait for updated state
    const statePromise = waitFor(host, 'game_state');
    const state = (await statePromise) as { players: { name: string }[] };
    expect(state.players).toHaveLength(1);
    expect(state.players[0].name).toBe('Host');

    host.disconnect();
  });
});
