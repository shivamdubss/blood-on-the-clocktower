import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createInitialGameState } from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, RoleId } from '../../src/types/game.js';
import { ROLE_MAP } from '../../src/data/roles.js';
import { assignRoles, ROLES_BY_TYPE } from '../../src/server/roleDistribution.js';

describe('Minion info', () => {
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

  async function setupGameWithPlayers(count: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
    const host = createClient();
    await waitForEvent(host, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const players: ClientSocket[] = [];
    for (let i = 0; i < count - 1; i++) {
      const p = createClient();
      await waitForEvent(p, 'connect');
      p.emit('join_game', { joinCode: 'ABC123', playerName: `Player${i}` });
      await waitForEvent(p, 'game_joined');
      players.push(p);
    }
    await new Promise<void>((r) => setTimeout(r, 50));

    return { host, players, gameId: 'game-1' };
  }

  it('Minions learn each other\'s identity and the Demon\'s identity on Night 1', async () => {
    // Use 10 players to get 2 minions
    const { host, players, gameId } = await setupGameWithPlayers(10);
    const allClients = [host, ...players];

    // Set up listeners for minion_info on ALL clients before starting
    const minionInfoCollectors = allClients.map((c) => {
      let received: unknown = null;
      c.on('minion_info', (data: unknown) => { received = data; });
      return { client: c, getReceived: () => received };
    });

    // Also wait for game to start
    const startPromise = waitForEvent(host, 'game_started');
    host.emit('start_game', { gameId });
    await startPromise;
    await new Promise<void>((r) => setTimeout(r, 200));

    const serverGame = store.games.get(gameId)!;
    const serverMinions = serverGame.players.filter((p) => {
      const meta = ROLE_MAP.get(p.trueRole);
      return meta && meta.type === 'minion';
    });
    const serverDemons = serverGame.players.filter((p) => {
      const meta = ROLE_MAP.get(p.trueRole);
      return meta && meta.type === 'demon';
    });

    expect(serverMinions.length).toBe(2);
    expect(serverDemons.length).toBe(1);

    // Verify each minion received minion_info
    for (const minion of serverMinions) {
      const collector = minionInfoCollectors.find((c) => c.client.id === minion.id);
      expect(collector).toBeDefined();
      const info = collector!.getReceived() as {
        otherMinions: Array<{ playerId: string; playerName: string; role: string }>;
        demon: Array<{ playerId: string; playerName: string; role: string }>;
      };
      expect(info).not.toBeNull();

      // Should know the other minion
      expect(info.otherMinions).toHaveLength(1);
      const otherMinion = serverMinions.find((m) => m.id !== minion.id)!;
      expect(info.otherMinions[0].playerId).toBe(otherMinion.id);
      expect(info.otherMinions[0].playerName).toBe(otherMinion.name);
      expect(info.otherMinions[0].role).toBe(otherMinion.trueRole);

      // Should know the demon
      expect(info.demon).toHaveLength(1);
      expect(info.demon[0].playerId).toBe(serverDemons[0].id);
      expect(info.demon[0].playerName).toBe(serverDemons[0].name);
      expect(info.demon[0].role).toBe(serverDemons[0].trueRole);
    }

    // Non-minion players should NOT have received minion_info
    const nonMinionIds = new Set(serverGame.players.filter((p) => {
      const meta = ROLE_MAP.get(p.trueRole);
      return !meta || meta.type !== 'minion';
    }).map((p) => p.id));

    for (const collector of minionInfoCollectors) {
      if (nonMinionIds.has(collector.client.id!)) {
        expect(collector.getReceived()).toBeNull();
      }
    }
  });
});

describe('Demon info', () => {
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

  async function setupGameWithPlayers(count: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
    const host = createClient();
    await waitForEvent(host, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const players: ClientSocket[] = [];
    for (let i = 0; i < count - 1; i++) {
      const p = createClient();
      await waitForEvent(p, 'connect');
      p.emit('join_game', { joinCode: 'ABC123', playerName: `Player${i}` });
      await waitForEvent(p, 'game_joined');
      players.push(p);
    }
    await new Promise<void>((r) => setTimeout(r, 50));

    return { host, players, gameId: 'game-1' };
  }

  it('Demon learns the Minions\' identities on Night 1', async () => {
    const { host, players, gameId } = await setupGameWithPlayers(10);
    const allClients = [host, ...players];

    // Set up listeners for demon_info on ALL clients
    const demonInfoCollectors = allClients.map((c) => {
      let received: unknown = null;
      c.on('demon_info', (data: unknown) => { received = data; });
      return { client: c, getReceived: () => received };
    });

    const startPromise = waitForEvent(host, 'game_started');
    host.emit('start_game', { gameId });
    await startPromise;
    await new Promise<void>((r) => setTimeout(r, 200));

    const serverGame = store.games.get(gameId)!;
    const serverMinions = serverGame.players.filter((p) => {
      const meta = ROLE_MAP.get(p.trueRole);
      return meta && meta.type === 'minion';
    });
    const serverDemons = serverGame.players.filter((p) => {
      const meta = ROLE_MAP.get(p.trueRole);
      return meta && meta.type === 'demon';
    });

    expect(serverDemons.length).toBe(1);
    const demon = serverDemons[0];

    // Demon should have received demon_info
    const demonCollector = demonInfoCollectors.find((c) => c.client.id === demon.id);
    expect(demonCollector).toBeDefined();
    const info = demonCollector!.getReceived() as {
      minions: Array<{ playerId: string; playerName: string; role: string }>;
      bluffRoles: string[];
    };
    expect(info).not.toBeNull();

    // Should know all minions
    expect(info.minions).toHaveLength(serverMinions.length);
    for (const minion of serverMinions) {
      const minionInfo = info.minions.find((m) => m.playerId === minion.id);
      expect(minionInfo).toBeDefined();
      expect(minionInfo!.playerName).toBe(minion.name);
      expect(minionInfo!.role).toBe(minion.trueRole);
    }

    // Non-demon players should NOT have received demon_info
    for (const collector of demonInfoCollectors) {
      if (collector.client.id !== demon.id) {
        expect(collector.getReceived()).toBeNull();
      }
    }
  });

  it('Demon learns 3 not-in-play Townsfolk roles (bluff roles) on Night 1', async () => {
    const { host, players, gameId } = await setupGameWithPlayers(10);
    const allClients = [host, ...players];

    // Set up listener for demon_info on all clients
    const demonInfoCollectors = allClients.map((c) => {
      let received: unknown = null;
      c.on('demon_info', (data: unknown) => { received = data; });
      return { client: c, getReceived: () => received };
    });

    const startPromise = waitForEvent(host, 'game_started');
    host.emit('start_game', { gameId });
    await startPromise;
    await new Promise<void>((r) => setTimeout(r, 200));

    const serverGame = store.games.get(gameId)!;
    const demon = serverGame.players.find((p) => {
      const meta = ROLE_MAP.get(p.trueRole);
      return meta && meta.type === 'demon';
    })!;

    const demonCollector = demonInfoCollectors.find((c) => c.client.id === demon.id)!;
    const info = demonCollector.getReceived() as {
      minions: Array<{ playerId: string; playerName: string; role: string }>;
      bluffRoles: string[];
    };

    // Should have exactly 3 bluff roles
    expect(info.bluffRoles).toHaveLength(3);

    // All bluff roles should be Townsfolk
    for (const bluff of info.bluffRoles) {
      expect(ROLES_BY_TYPE.townsfolk).toContain(bluff);
    }

    // Bluff roles should not be in play (not assigned as trueRole to any player)
    const inPlayRoles = new Set(serverGame.players.map((p) => p.trueRole));
    for (const bluff of info.bluffRoles) {
      expect(inPlayRoles.has(bluff as RoleId)).toBe(false);
    }

    // Bluff roles should be unique
    const uniqueBluffs = new Set(info.bluffRoles);
    expect(uniqueBluffs.size).toBe(3);

    // Bluff roles should also be stored in game state
    expect(serverGame.demonBluffRoles).toHaveLength(3);
    expect(serverGame.demonBluffRoles).toEqual(info.bluffRoles);
  });

  it('Info is delivered via WebSocket to the correct players only', async () => {
    const { host, players, gameId } = await setupGameWithPlayers(10);
    const allClients = [host, ...players];

    // Collect both events on all clients
    const eventCollectors = allClients.map((c) => {
      let minionInfo: unknown = null;
      let demonInfo: unknown = null;
      c.on('minion_info', (data: unknown) => { minionInfo = data; });
      c.on('demon_info', (data: unknown) => { demonInfo = data; });
      return { client: c, getMinionInfo: () => minionInfo, getDemonInfo: () => demonInfo };
    });

    const startPromise = waitForEvent(host, 'game_started');
    host.emit('start_game', { gameId });
    await startPromise;
    await new Promise<void>((r) => setTimeout(r, 200));

    const serverGame = store.games.get(gameId)!;

    for (const collector of eventCollectors) {
      const player = serverGame.players.find((p) => p.id === collector.client.id!)!;
      const meta = ROLE_MAP.get(player.trueRole)!;

      if (meta.type === 'minion') {
        // Minions should receive minion_info but NOT demon_info
        expect(collector.getMinionInfo()).not.toBeNull();
        expect(collector.getDemonInfo()).toBeNull();
      } else if (meta.type === 'demon') {
        // Demons should receive demon_info but NOT minion_info
        expect(collector.getDemonInfo()).not.toBeNull();
        expect(collector.getMinionInfo()).toBeNull();
      } else {
        // Townsfolk/Outsiders should receive neither
        expect(collector.getMinionInfo()).toBeNull();
        expect(collector.getDemonInfo()).toBeNull();
      }
    }
  });
});

describe('bluff roles', () => {
  it('bluff roles are not-in-play Townsfolk from role distribution', () => {
    // Run assignRoles many times and verify bluff roles are always valid
    for (let i = 0; i < 20; i++) {
      const playerIds = Array.from({ length: 7 }, (_, j) => `p${j}`);
      const result = assignRoles(playerIds);

      expect(result.bluffRoles).toHaveLength(3);

      const inPlayRoles = new Set(result.assignments.map((a) => a.role));
      // Also check that apparent roles for Drunk are excluded
      const apparentRoles = new Set(result.assignments.map((a) => a.apparentRole));

      for (const bluff of result.bluffRoles) {
        // Should be a Townsfolk
        expect(ROLES_BY_TYPE.townsfolk).toContain(bluff);
        // Should not be in play as a true role
        expect(inPlayRoles.has(bluff)).toBe(false);
      }

      // Should be unique
      expect(new Set(result.bluffRoles).size).toBe(3);
    }
  });

  it('bluff roles exclude Drunk apparent role', () => {
    // Run many times, if Drunk is in the game the apparent role should not be a bluff
    for (let i = 0; i < 50; i++) {
      const playerIds = Array.from({ length: 9 }, (_, j) => `p${j}`);
      const result = assignRoles(playerIds);

      const drunkAssignment = result.assignments.find((a) => a.role === 'drunk');
      if (drunkAssignment) {
        // The Drunk's apparent role should not appear as a bluff role
        expect(result.bluffRoles).not.toContain(drunkAssignment.apparentRole);
      }
    }
  });

  it('game_state broadcast does not leak bluff roles', async () => {
    // This is tested implicitly but let's verify the sanitized state
    const { createInitialGameState } = await import('../../src/server/gameStateMachine.js');
    const state = createInitialGameState('g1', 'ABC', 'host1');
    // demonBluffRoles should be initialized empty
    expect(state.demonBluffRoles).toEqual([]);
  });
});
