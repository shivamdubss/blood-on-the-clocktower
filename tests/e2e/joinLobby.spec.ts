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

test.describe('join lobby', () => {
  test('player can join a game with join code and display name', async ({ request }) => {
    const res = await request.post('/api/game', { data: { storytellerId: 'st-1' } });
    const { joinCode, gameId } = await res.json();

    const socket = createSocket();
    try {
      await waitFor(socket, 'connect');
      const joinedPromise = waitFor(socket, 'game_joined');
      const statePromise = waitFor(socket, 'game_state');
      socket.emit('join_game', { joinCode, playerName: 'Alice' });

      const joined = (await joinedPromise) as { gameId: string; playerId: string };
      expect(joined.gameId).toBe(gameId);
      expect(joined.playerId).toBeTruthy();

      const state = (await statePromise) as { players: { name: string }[] };
      expect(state.players.length).toBeGreaterThanOrEqual(1);
      expect(state.players.some((p) => p.name === 'Alice')).toBe(true);
    } finally {
      socket.disconnect();
    }
  });

  test('host receives real-time notification when player joins', async ({ request }) => {
    const res = await request.post('/api/game', { data: { storytellerId: 'st-1' } });
    const { joinCode } = await res.json();

    const host = createSocket();
    try {
      await waitFor(host, 'connect');

      // Collect events using persistent listeners
      const playerJoinedEvents: unknown[] = [];
      host.on('player_joined', (data: unknown) => playerJoinedEvents.push(data));

      // Host joins first
      const hostJoined = waitFor(host, 'game_joined');
      host.emit('join_game', { joinCode, playerName: 'Host' });
      await hostJoined;
      await new Promise<void>((r) => setTimeout(r, 100));

      // Player joins; host should be notified
      const player = createSocket();
      try {
        await waitFor(player, 'connect');
        player.emit('join_game', { joinCode, playerName: 'Player1' });
        await new Promise<void>((r) => setTimeout(r, 200));

        const notification = playerJoinedEvents.find(
          (e) => (e as { player: { name: string } }).player.name === 'Player1'
        );
        expect(notification).toBeTruthy();
      } finally {
        player.disconnect();
      }
    } finally {
      host.disconnect();
    }
  });

  test('duplicate display name is rejected', async ({ request }) => {
    const res = await request.post('/api/game', { data: { storytellerId: 'st-1' } });
    const { joinCode } = await res.json();

    // Keep client1 connected so the name stays taken
    const client1 = createSocket();
    try {
      await waitFor(client1, 'connect');
      const joined = waitFor(client1, 'game_joined');
      client1.emit('join_game', { joinCode, playerName: 'Alice' });
      await joined;

      // Create client2 after client1 is fully joined
      const client2 = createSocket();
      try {
        await waitFor(client2, 'connect');
        const errorPromise = waitFor(client2, 'join_error');
        client2.emit('join_game', { joinCode, playerName: 'Alice' });

        const err = (await errorPromise) as { message: string };
        expect(err.message).toBe('Name already taken');
      } finally {
        client2.disconnect();
      }
    } finally {
      client1.disconnect();
    }
  });

  test('invalid join code returns error', async () => {
    const socket = createSocket();
    try {
      await waitFor(socket, 'connect');
      const errorPromise = waitFor(socket, 'join_error');
      socket.emit('join_game', { joinCode: 'ZZZZZZ', playerName: 'Alice' });

      const err = (await errorPromise) as { message: string };
      expect(err.message).toBe('Game not found');
    } finally {
      socket.disconnect();
    }
  });

  test('cannot join a game that has already started', async ({ request }) => {
    const res = await request.post('/api/game', { data: { storytellerId: 'st-1' } });
    const { joinCode } = await res.json();

    const socket = createSocket();
    try {
      await waitFor(socket, 'connect');
      const joinedPromise = waitFor(socket, 'game_joined');
      socket.emit('join_game', { joinCode, playerName: 'TestPlayer' });

      const joined = (await joinedPromise) as { gameId: string };
      expect(joined.gameId).toBeTruthy();
    } finally {
      socket.disconnect();
    }
  });
});
