import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPendingDeath,
  resolveDawnDeaths,
  killPlayer,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState } from '../../src/types/game.js';

describe('dawn announcement', () => {
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

  async function setupGameInNight(count: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
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

    // Start game and wait for it
    host.emit('start_game', { gameId: 'game-1' });
    await waitForEvent(host, 'game_started');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Manually set phase to night (simulating a night phase)
    const currentGame = store.games.get('game-1')!;
    store.games.set('game-1', { ...currentGame, phase: 'night' });

    return { host, players, gameId: 'game-1' };
  }

  // --- State machine unit tests ---

  it('addPendingDeath adds a player to pendingDeaths', () => {
    const state = createInitialGameState('g1', 'ABC', 'st1');
    const updated = addPendingDeath(state, 'player1');
    expect(updated.pendingDeaths).toContain('player1');
  });

  it('addPendingDeath does not duplicate a player', () => {
    const state = createInitialGameState('g1', 'ABC', 'st1');
    const s1 = addPendingDeath(state, 'player1');
    const s2 = addPendingDeath(s1, 'player1');
    expect(s2.pendingDeaths).toEqual(['player1']);
  });

  it('resolveDawnDeaths kills pending players and transitions to day/dawn', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = {
      ...state,
      phase: 'night',
      players: [
        { id: 'p1', name: 'Alice', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0 },
        { id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 1 },
      ],
      pendingDeaths: ['p1'],
    };

    const result = resolveDawnDeaths(state);
    expect(result.phase).toBe('day');
    expect(result.daySubPhase).toBe('dawn');
    expect(result.dayNumber).toBe(1);
    expect(result.pendingDeaths).toEqual([]);
    const deadPlayer = result.players.find((p) => p.id === 'p1');
    expect(deadPlayer?.isAlive).toBe(false);
    const alivePlayer = result.players.find((p) => p.id === 'p2');
    expect(alivePlayer?.isAlive).toBe(true);
  });

  it('resolveDawnDeaths with no pending deaths still transitions to day/dawn', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = {
      ...state,
      phase: 'night',
      players: [
        { id: 'p1', name: 'Alice', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0 },
      ],
      pendingDeaths: [],
    };

    const result = resolveDawnDeaths(state);
    expect(result.phase).toBe('day');
    expect(result.daySubPhase).toBe('dawn');
    expect(result.dayNumber).toBe(1);
    expect(result.players[0].isAlive).toBe(true);
  });

  // --- WebSocket integration tests ---

  it('players who died during the night are announced by name at dawn', async () => {
    const { host, players, gameId } = await setupGameInNight(7);

    // Add a pending death
    const game = store.games.get(gameId)!;
    const victimId = game.players[1].id; // second player
    const victimName = game.players[1].name;
    store.games.set(gameId, addPendingDeath(game, victimId));

    // Set up dawn announcement listener on a player
    const dawnPromise = waitForEvent(players[0], 'dawn_announcement');

    // Storyteller triggers transition to day
    host.emit('transition_to_day', { gameId });

    const announcement = (await dawnPromise) as { deaths: Array<{ playerId: string; playerName: string }>; dayNumber: number };
    expect(announcement.deaths).toHaveLength(1);
    expect(announcement.deaths[0].playerName).toBe(victimName);
    expect(announcement.deaths[0].playerId).toBe(victimId);
    expect(announcement.dayNumber).toBe(1);
  });

  it('all connected clients receive the death announcement simultaneously', async () => {
    const { host, players, gameId } = await setupGameInNight(7);

    const game = store.games.get(gameId)!;
    const victimId = game.players[1].id;
    store.games.set(gameId, addPendingDeath(game, victimId));

    // Listen on all clients
    const promises = [host, ...players].map((c) => waitForEvent(c, 'dawn_announcement'));

    host.emit('transition_to_day', { gameId });

    const results = await Promise.all(promises);
    for (const result of results) {
      const ann = result as { deaths: Array<{ playerId: string; playerName: string }> };
      expect(ann.deaths).toHaveLength(1);
    }
  });

  it('dead players are marked as dead in the game state after dawn', async () => {
    const { host, players, gameId } = await setupGameInNight(7);

    const game = store.games.get(gameId)!;
    const victimId = game.players[1].id;
    store.games.set(gameId, addPendingDeath(game, victimId));

    const statePromise = waitForEvent(players[0], 'game_state');
    host.emit('transition_to_day', { gameId });
    await waitForEvent(host, 'dawn_announcement');

    const state = (await statePromise) as GameState;
    const victim = state.players.find((p) => p.id === victimId);
    expect(victim?.isAlive).toBe(false);
  });

  it('if no deaths occurred, a no-deaths message is shown', async () => {
    const { host, players, gameId } = await setupGameInNight(7);

    // No pending deaths
    const dawnPromise = waitForEvent(players[0], 'dawn_announcement');

    host.emit('transition_to_day', { gameId });

    const announcement = (await dawnPromise) as { deaths: Array<unknown>; message?: string; dayNumber: number };
    expect(announcement.deaths).toHaveLength(0);
    expect(announcement.message).toBe('No one died last night.');
  });

  it('only the Storyteller can trigger transition to day', async () => {
    const { host, players, gameId } = await setupGameInNight(7);

    const errorPromise = waitForEvent(players[0], 'transition_error');
    players[0].emit('transition_to_day', { gameId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Only the Storyteller can transition phases');
  });

  it('transition to day fails if not in night or setup phase', async () => {
    const { host, gameId } = await setupGameInNight(7);

    // First transition to day
    host.emit('transition_to_day', { gameId });
    await waitForEvent(host, 'dawn_announcement');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Try again from day phase
    const errorPromise = waitForEvent(host, 'transition_error');
    host.emit('transition_to_day', { gameId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Can only transition to day from night or setup phase');
  });
});
