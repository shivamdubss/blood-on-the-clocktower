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

test.describe('role reveal', () => {
  test('each player receives their private role card after game start', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

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

    // Listen for your_role on all clients
    const rolePromises = sockets.map((s) => waitFor(s, 'your_role'));

    host.emit('start_game', { gameId });

    const roleResults = await Promise.all(rolePromises);

    for (const result of roleResults) {
      const roleData = result as { role: string; name: string; team: string; ability: string };
      expect(roleData.role).toBeTruthy();
      expect(roleData.name).toBeTruthy();
      expect(typeof roleData.team).toBe('string');
      expect(typeof roleData.ability).toBe('string');
    }

    for (const s of sockets) s.disconnect();
  });

  test('storyteller receives grimoire with all true roles', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

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

    const grimoirePromise = waitFor(host, 'grimoire');
    host.emit('start_game', { gameId });

    const grimoire = (await grimoirePromise) as {
      players: Array<{
        playerId: string;
        playerName: string;
        trueRole: { id: string; name: string; team: string; ability: string };
        apparentRole: { id: string; name: string; team: string; ability: string };
        isAlive: boolean;
      }>;
    };

    expect(grimoire.players).toHaveLength(5);

    for (const p of grimoire.players) {
      expect(p.playerId).toBeTruthy();
      expect(p.playerName).toBeTruthy();
      expect(p.trueRole.id).toBeTruthy();
      expect(p.trueRole.name).toBeTruthy();
      expect(p.trueRole.team).toBeTruthy();
      expect(p.isAlive).toBe(true);
    }

    for (const s of sockets) s.disconnect();
  });

  test('game_state does not leak role information to players', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

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

    // Non-host player listens for game_state
    const nonHost = sockets[1];
    const statePromise = waitFor(nonHost, 'game_state');

    host.emit('start_game', { gameId });

    const state = (await statePromise) as {
      phase: string;
      players: Array<{ trueRole: string; apparentRole: string; isPoisoned: boolean; isDrunk: boolean }>;
      hostSecret: string;
    };

    expect(state.phase).toBe('setup');
    // All role fields should be sanitized
    for (const p of state.players) {
      expect(p.trueRole).toBe('washerwoman');
      expect(p.apparentRole).toBe('washerwoman');
      expect(p.isPoisoned).toBe(false);
      expect(p.isDrunk).toBe(false);
    }
    expect(state.hostSecret).toBe('');

    for (const s of sockets) s.disconnect();
  });
});
