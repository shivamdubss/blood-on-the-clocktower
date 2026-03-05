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

test.describe('seating circle', () => {
  test('players have seatIndex assigned in join order and consistent across clients', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Alice', hostSecret });
    await waitFor(host, 'game_joined');

    const sockets: ClientSocket[] = [];
    const names = ['Bob', 'Carol', 'Dave', 'Eve'];
    for (const name of names) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: name });
      await waitFor(s, 'game_joined');
      sockets.push(s);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // Start game and capture game_state from two different clients
    const hostStateP = waitFor(host, 'game_state');
    const player2StateP = waitFor(sockets[1], 'game_state');
    host.emit('start_game', { gameId });

    const hostState = (await hostStateP) as { players: Array<{ name: string; seatIndex: number }> };
    const player2State = (await player2StateP) as { players: Array<{ name: string; seatIndex: number }> };

    // seatIndex assigned in join order (host=0, Bob=1, Carol=2, Dave=3, Eve=4)
    const allNames = ['Alice', ...names];
    for (let i = 0; i < allNames.length; i++) {
      const hp = hostState.players.find((p) => p.name === allNames[i]);
      expect(hp).toBeDefined();
      expect(hp!.seatIndex).toBe(i);
    }

    // Seating order is consistent across clients
    for (const p of hostState.players) {
      const match = player2State.players.find((q) => q.name === p.name);
      expect(match).toBeDefined();
      expect(match!.seatIndex).toBe(p.seatIndex);
    }

    host.disconnect();
    for (const s of sockets) s.disconnect();
  });

  test('dead players are marked in the seating data', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Alice', hostSecret });
    await waitFor(host, 'game_joined');

    const sockets: ClientSocket[] = [];
    const playerIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `P${i}` });
      const joined = (await waitFor(s, 'game_joined')) as { playerId: string };
      sockets.push(s);
      playerIds.push(joined.playerId);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // Start game
    const startPromises = sockets.map((s) => waitFor(s, 'game_state'));
    host.emit('start_game', { gameId });
    await Promise.all(startPromises);

    // Kill a player via storyteller override
    const statePromise = waitFor(sockets[1], 'game_state');
    host.emit('storyteller_override', {
      gameId,
      override: { type: 'kill_player', playerId: playerIds[0] },
    });

    const state = (await statePromise) as {
      players: Array<{ id: string; isAlive: boolean; seatIndex: number }>;
    };

    // Dead player retains seatIndex and is marked dead
    const dead = state.players.find((p) => p.id === playerIds[0]);
    expect(dead).toBeDefined();
    expect(dead!.isAlive).toBe(false);
    expect(typeof dead!.seatIndex).toBe('number');

    // Living players still alive with seatIndex
    const alive = state.players.find((p) => p.id === playerIds[1]);
    expect(alive).toBeDefined();
    expect(alive!.isAlive).toBe(true);
    expect(typeof alive!.seatIndex).toBe('number');

    host.disconnect();
    for (const s of sockets) s.disconnect();
  });

  test('seating order reflects adjacency used by game logic', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Alice', hostSecret });
    await waitFor(host, 'game_joined');

    const sockets: ClientSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `P${i}` });
      await waitFor(s, 'game_joined');
      sockets.push(s);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    const statePromise = waitFor(sockets[0], 'game_state');
    host.emit('start_game', { gameId });
    const state = (await statePromise) as {
      players: Array<{ name: string; seatIndex: number }>;
    };

    // Sort by seatIndex to get circle order
    const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);

    // Verify adjacency: each player's neighbors are index-1 and index+1 (wrapping)
    for (let i = 0; i < sorted.length; i++) {
      const prev = sorted[(i - 1 + sorted.length) % sorted.length];
      const next = sorted[(i + 1) % sorted.length];
      // Adjacent seatIndexes differ by 1 (or wrap around)
      expect(Math.abs(sorted[i].seatIndex - prev.seatIndex) === 1 ||
             Math.abs(sorted[i].seatIndex - prev.seatIndex) === sorted.length - 1).toBe(true);
      expect(Math.abs(sorted[i].seatIndex - next.seatIndex) === 1 ||
             Math.abs(sorted[i].seatIndex - next.seatIndex) === sorted.length - 1).toBe(true);
    }

    host.disconnect();
    for (const s of sockets) s.disconnect();
  });
});
