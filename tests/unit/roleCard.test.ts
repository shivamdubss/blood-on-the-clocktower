import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createInitialGameState } from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState } from '../../src/types/game.js';
import { ROLE_MAP } from '../../src/data/roles.js';

describe('role card', () => {
  let httpServer: ReturnType<typeof createServer>;
  let ioServer: Server;
  let store: GameStore;
  let port: number;
  const clients: ClientSocket[] = [];

  function createClient(): ClientSocket {
    const c = ioClient(`http://localhost:${port}`, {
      forceNew: true,
      transports: ['websocket'],
    });
    clients.push(c);
    return c;
  }

  function waitForEvent(socket: ClientSocket, event: string, timeout = 3000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
      socket.once(event, (data: unknown) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  beforeEach(async () => {
    store = { games: new Map<string, GameState>() };
    httpServer = createServer();
    ioServer = new Server(httpServer, { cors: { origin: '*' } });
    registerSocketHandlers(ioServer, store);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    clients.length = 0;
    ioServer.close();
    httpServer.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });

  async function setupGameWith5Players(): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
    const host = createClient();
    await waitForEvent(host, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const players: ClientSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const p = createClient();
      await waitForEvent(p, 'connect');
      p.emit('join_game', { joinCode: 'ABC123', playerName: `Player${i}` });
      await waitForEvent(p, 'game_joined');
      players.push(p);
    }
    await new Promise<void>((r) => setTimeout(r, 50));

    return { host, players, gameId: 'game-1' };
  }

  it('each player receives only their own role via WebSocket (not other players\' roles)', async () => {
    const { host, players, gameId } = await setupGameWith5Players();
    const allClients = [host, ...players];

    // Set up listeners for your_role before starting
    const rolePromises = allClients.map((c) => waitForEvent(c, 'your_role'));

    host.emit('start_game', { gameId });

    const roleResults = await Promise.all(rolePromises);

    // Each player should receive exactly one role event with their own role
    for (const result of roleResults) {
      const roleData = result as { role: string; name: string; team: string; ability: string };
      expect(roleData.role).toBeTruthy();
      expect(roleData.name).toBeTruthy();
      expect(roleData.team).toBeTruthy();
      expect(roleData.ability).toBeTruthy();
    }

    // Verify each player got a valid role from the role map
    for (const result of roleResults) {
      const roleData = result as { role: string };
      expect(ROLE_MAP.has(roleData.role as any)).toBe(true);
    }

    // Verify each player's role matches their server-side assignment
    const serverGame = store.games.get(gameId)!;
    for (let i = 0; i < allClients.length; i++) {
      const clientId = allClients[i].id!;
      const serverPlayer = serverGame.players.find((p) => p.id === clientId)!;
      const roleData = roleResults[i] as { role: string };
      // Player should see their apparentRole (not necessarily trueRole, e.g. Drunk)
      expect(roleData.role).toBe(serverPlayer.apparentRole);
    }
  });

  it('role card displays role name, team, and ability description', async () => {
    const { host, players, gameId } = await setupGameWith5Players();
    const allClients = [host, ...players];

    const rolePromises = allClients.map((c) => waitForEvent(c, 'your_role'));
    host.emit('start_game', { gameId });
    const roleResults = await Promise.all(rolePromises);

    for (const result of roleResults) {
      const roleData = result as { role: string; name: string; team: string; ability: string };
      // Look up the expected metadata
      const expectedMeta = ROLE_MAP.get(roleData.role as any)!;
      expect(roleData.name).toBe(expectedMeta.name);
      expect(roleData.team).toBe(expectedMeta.team);
      expect(roleData.ability).toBe(expectedMeta.ability);
    }
  });

  it('storyteller grimoire shows all players\' true roles', async () => {
    const { host, gameId } = await setupGameWith5Players();

    const grimoirePromise = waitForEvent(host, 'grimoire');
    host.emit('start_game', { gameId });
    const grimoireData = (await grimoirePromise) as {
      players: Array<{
        playerId: string;
        playerName: string;
        trueRole: { id: string; name: string; team: string; ability: string };
        apparentRole: { id: string; name: string; team: string; ability: string };
        isAlive: boolean;
        isPoisoned: boolean;
        isDrunk: boolean;
      }>;
    };

    const serverGame = store.games.get(gameId)!;

    // Grimoire should have all 5 players
    expect(grimoireData.players).toHaveLength(5);

    // Each player's true role should match server state
    for (const gp of grimoireData.players) {
      const serverPlayer = serverGame.players.find((p) => p.id === gp.playerId)!;
      expect(gp.trueRole.id).toBe(serverPlayer.trueRole);
      expect(gp.apparentRole.id).toBe(serverPlayer.apparentRole);
      expect(gp.playerName).toBe(serverPlayer.name);
      expect(gp.isAlive).toBe(serverPlayer.isAlive);

      // Verify role metadata is complete
      const trueMeta = ROLE_MAP.get(serverPlayer.trueRole)!;
      expect(gp.trueRole.name).toBe(trueMeta.name);
      expect(gp.trueRole.team).toBe(trueMeta.team);
      expect(gp.trueRole.ability).toBe(trueMeta.ability);
    }
  });

  it('game_state broadcast does not leak other players\' true roles', async () => {
    const { host, players, gameId } = await setupGameWith5Players();
    const nonHost = players[0];

    const statePromise = waitForEvent(nonHost, 'game_state');
    host.emit('start_game', { gameId });
    const state = (await statePromise) as GameState;

    // game_state should have phase = setup
    expect(state.phase).toBe('setup');

    // All player role fields should be sanitized (no real roles leaked)
    for (const p of state.players) {
      expect(p.trueRole).toBe('washerwoman');
      expect(p.apparentRole).toBe('washerwoman');
      expect(p.isPoisoned).toBe(false);
      expect(p.isDrunk).toBe(false);
    }

    // hostSecret should be stripped
    expect(state.hostSecret).toBe('');
  });

  it('non-storyteller players do not receive grimoire event', async () => {
    const { host, players, gameId } = await setupGameWith5Players();
    const nonHost = players[0];

    let grimoireReceived = false;
    nonHost.on('grimoire', () => {
      grimoireReceived = true;
    });

    const rolePromise = waitForEvent(nonHost, 'your_role');
    host.emit('start_game', { gameId });
    await rolePromise;

    // Give time for any stray grimoire events
    await new Promise<void>((r) => setTimeout(r, 200));
    expect(grimoireReceived).toBe(false);
  });
});
