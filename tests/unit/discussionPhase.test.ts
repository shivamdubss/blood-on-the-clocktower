import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  resolveDawnDeaths,
  transitionDaySubPhase,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState } from '../../src/types/game.js';

describe('discussion phase', () => {
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

  async function setupGameInDawn(count: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
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

    // Start game
    host.emit('start_game', { gameId: 'game-1' });
    await waitForEvent(host, 'game_started');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Set phase to night then transition to day/dawn
    const currentGame = store.games.get('game-1')!;
    store.games.set('game-1', { ...currentGame, phase: 'night' });

    host.emit('transition_to_day', { gameId: 'game-1' });
    await waitForEvent(host, 'dawn_announcement');
    await new Promise<void>((r) => setTimeout(r, 50));

    return { host, players, gameId: 'game-1' };
  }

  // --- State machine unit tests ---

  it('transitionDaySubPhase changes daySubPhase and logs', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = { ...state, phase: 'day', daySubPhase: 'dawn' };

    const result = transitionDaySubPhase(state, 'discussion');
    expect(result.daySubPhase).toBe('discussion');
    expect(result.gameLog.length).toBeGreaterThan(0);
    const lastLog = result.gameLog[result.gameLog.length - 1];
    expect(lastLog.type).toBe('day_sub_phase_transition');
    expect((lastLog.data as { subPhase: string }).subPhase).toBe('discussion');
  });

  it('transitionDaySubPhase from discussion to nomination', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = { ...state, phase: 'day', daySubPhase: 'discussion' };

    const result = transitionDaySubPhase(state, 'nomination');
    expect(result.daySubPhase).toBe('nomination');
  });

  // --- WebSocket integration tests ---

  it('discussion phase begins after dawn announcement via start_discussion', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    // Verify we're in dawn phase
    const game = store.games.get(gameId)!;
    expect(game.daySubPhase).toBe('dawn');

    // Listen for discussion_started on a player
    const discussionPromise = waitForEvent(players[0], 'discussion_started');

    host.emit('start_discussion', { gameId });

    const result = (await discussionPromise) as { dayNumber: number };
    expect(result.dayNumber).toBe(1);

    // Verify state updated
    const updatedGame = store.games.get(gameId)!;
    expect(updatedGame.daySubPhase).toBe('discussion');
  });

  it('Storyteller can end discussion phase manually', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    // Start discussion first
    const discussionStartPromise = waitForEvent(players[0], 'discussion_started');
    host.emit('start_discussion', { gameId });
    await discussionStartPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // End discussion
    const endPromise = waitForEvent(players[0], 'discussion_ended');
    host.emit('end_discussion', { gameId });

    const result = (await endPromise) as { dayNumber: number };
    expect(result.dayNumber).toBe(1);

    const updatedGame = store.games.get(gameId)!;
    expect(updatedGame.daySubPhase).toBe('nomination');
  });

  it('players see a visual indicator via game_state with discussion sub-phase', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    const statePromise = waitForEvent(players[0], 'game_state');
    host.emit('start_discussion', { gameId });

    const state = (await statePromise) as GameState;
    expect(state.phase).toBe('day');
    expect(state.daySubPhase).toBe('discussion');
  });

  it('transitioning out of discussion moves to nomination window', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    // Start discussion
    host.emit('start_discussion', { gameId });
    await waitForEvent(players[0], 'discussion_started');
    await new Promise<void>((r) => setTimeout(r, 50));

    // End discussion -> nomination
    const statePromise = waitForEvent(players[0], 'game_state');
    host.emit('end_discussion', { gameId });

    const state = (await statePromise) as GameState;
    expect(state.phase).toBe('day');
    expect(state.daySubPhase).toBe('nomination');
  });

  it('only the Storyteller can start discussion', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    const errorPromise = waitForEvent(players[0], 'discussion_error');
    players[0].emit('start_discussion', { gameId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Only the Storyteller can start discussion');
  });

  it('only the Storyteller can end discussion', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    host.emit('start_discussion', { gameId });
    await waitForEvent(players[0], 'discussion_started');
    await new Promise<void>((r) => setTimeout(r, 50));

    const errorPromise = waitForEvent(players[0], 'discussion_error');
    players[0].emit('end_discussion', { gameId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Only the Storyteller can end discussion');
  });

  it('cannot start discussion if not in dawn phase', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    // Start and end discussion to move to nomination
    host.emit('start_discussion', { gameId });
    await waitForEvent(host, 'discussion_started');
    await new Promise<void>((r) => setTimeout(r, 50));

    host.emit('end_discussion', { gameId });
    await waitForEvent(host, 'discussion_ended');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Try to start discussion again from nomination
    const errorPromise = waitForEvent(host, 'discussion_error');
    host.emit('start_discussion', { gameId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Can only start discussion from dawn phase');
  });

  it('cannot end discussion if not in discussion phase', async () => {
    const { host, gameId } = await setupGameInDawn(7);

    // We're in dawn, try to end discussion without starting it
    const errorPromise = waitForEvent(host, 'discussion_error');
    host.emit('end_discussion', { gameId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Can only end discussion during discussion phase');
  });

  it('all clients receive discussion_started simultaneously', async () => {
    const { host, players, gameId } = await setupGameInDawn(7);

    const promises = [host, ...players].map((c) => waitForEvent(c, 'discussion_started'));
    host.emit('start_discussion', { gameId });

    const results = await Promise.all(promises);
    for (const result of results) {
      const r = result as { dayNumber: number };
      expect(r.dayNumber).toBe(1);
    }
  });
});
