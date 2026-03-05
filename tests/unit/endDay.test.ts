import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  transitionToNight,
  transitionDaySubPhase,
  addNomination,
  resolveDawnDeaths,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, Player } from '../../src/types/game.js';

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `player-${i}`,
    name: `Player ${i}`,
    trueRole: 'washerwoman' as const,
    apparentRole: 'washerwoman' as const,
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex: i,
  }));
}

describe('end day', () => {
  describe('state machine', () => {
    it('transitionToNight changes phase to night and clears day state', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(5) };
      state = resolveDawnDeaths(state); // → day/dawn
      state = transitionDaySubPhase(state, 'discussion');
      state = transitionDaySubPhase(state, 'nomination');
      state = addNomination(state, 'player-0', 'player-1');
      state = transitionDaySubPhase(state, 'end');

      const result = transitionToNight(state);

      expect(result.phase).toBe('night');
      expect(result.daySubPhase).toBeNull();
      expect(result.nominations).toEqual([]);
      expect(result.activeNominationIndex).toBeNull();
      expect(result.executedPlayerId).toBeNull();
    });

    it('transitionToNight preserves dayNumber', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(5) };
      state = resolveDawnDeaths(state); // dayNumber = 1
      state = transitionDaySubPhase(state, 'end');

      const result = transitionToNight(state);
      expect(result.dayNumber).toBe(1);
    });

    it('transitionToNight adds phase_transition log entry', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(5) };
      state = resolveDawnDeaths(state);
      state = transitionDaySubPhase(state, 'end');
      const logLengthBefore = state.gameLog.length;

      const result = transitionToNight(state);
      expect(result.gameLog.length).toBe(logLengthBefore + 1);
      expect(result.gameLog[result.gameLog.length - 1].type).toBe('phase_transition');
      expect(result.gameLog[result.gameLog.length - 1].data).toEqual({ phase: 'night' });
    });
  });

  describe('WebSocket', () => {
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

    function setupGameInDayEnd(): { gameId: string; storytellerClient: ClientSocket; playerClient: ClientSocket } {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      state = { ...state, players: makePlayers(5) };
      state = resolveDawnDeaths(state);
      state = transitionDaySubPhase(state, 'end');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const player = createClient();

      return { gameId, storytellerClient: storyteller, playerClient: player };
    }

    it('Storyteller can end the day and transition to night', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      state = { ...state, players: makePlayers(5), phase: 'lobby' };

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      // Join the room via join_game, then override state
      state = { ...state, storytellerId: storyteller.id! };
      store.games.set(gameId, state);
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST', hostSecret: '' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Override state to day/end
      const gameAfterJoin = store.games.get(gameId)!;
      const updatedState: GameState = {
        ...gameAfterJoin,
        storytellerId: storyteller.id!,
        phase: 'day',
        daySubPhase: 'end',
        dayNumber: 1,
        players: [...makePlayers(5), ...gameAfterJoin.players.filter(p => p.id === storyteller.id)],
      };
      store.games.set(gameId, updatedState);

      const nightPromise = waitForEvent(storyteller, 'night_started');
      const statePromise = waitForEvent(storyteller, 'game_state');

      storyteller.emit('end_day', { gameId });

      const nightData = await nightPromise as { dayNumber: number };
      expect(nightData.dayNumber).toBe(1);

      const stateData = await statePromise as GameState;
      expect(stateData.phase).toBe('night');
      expect(stateData.daySubPhase).toBeNull();
    });

    it('non-Storyteller cannot end the day', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', 'some-other-id');
      state = { ...state, players: makePlayers(5) };
      state = resolveDawnDeaths(state);
      state = transitionDaySubPhase(state, 'end');
      store.games.set(gameId, state);

      const player = createClient();
      await new Promise<void>((resolve) => player.on('connect', resolve));

      const errorPromise = waitForEvent(player, 'end_day_error');
      player.emit('end_day', { gameId });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Only the Storyteller can end the day');
    });

    it('cannot end the day during nomination phase (must close nominations first)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      state = { ...state, players: makePlayers(5) };
      state = resolveDawnDeaths(state);
      state = transitionDaySubPhase(state, 'nomination');

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      state = { ...state, storytellerId: storyteller.id! };
      store.games.set(gameId, state);

      const errorPromise = waitForEvent(storyteller, 'end_day_error');
      storyteller.emit('end_day', { gameId });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Must close nominations before ending the day');
    });

    it('cannot end the day during discussion phase', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      state = { ...state, players: makePlayers(5) };
      state = resolveDawnDeaths(state);
      state = transitionDaySubPhase(state, 'discussion');

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      state = { ...state, storytellerId: storyteller.id! };
      store.games.set(gameId, state);

      const errorPromise = waitForEvent(storyteller, 'end_day_error');
      storyteller.emit('end_day', { gameId });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Must close nominations before ending the day');
    });

    it('can end the day from execution sub-phase', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      // Join room
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Override state to day/execution
      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'day',
        daySubPhase: 'execution',
        dayNumber: 1,
        players: [...makePlayers(5), ...g.players],
      });

      const nightPromise = waitForEvent(storyteller, 'night_started');
      storyteller.emit('end_day', { gameId });

      const nightData = await nightPromise as { dayNumber: number };
      expect(nightData.dayNumber).toBe(1);
    });

    it('all clients receive night_started simultaneously', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      // Join storyteller and wait for confirmation
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');

      const player1 = createClient();
      await new Promise<void>((resolve) => player1.on('connect', resolve));

      // Join player1 and wait for confirmation
      player1.emit('join_game', { joinCode: 'ABC123', playerName: 'P1' });
      await waitForEvent(player1, 'game_joined');

      // Override state to day/end
      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'day',
        daySubPhase: 'end',
        dayNumber: 1,
      });

      const stNight = waitForEvent(storyteller, 'night_started');
      const p1Night = waitForEvent(player1, 'night_started');

      storyteller.emit('end_day', { gameId });

      const [stData, p1Data] = await Promise.all([stNight, p1Night]);
      expect(stData).toEqual({ dayNumber: 1 });
      expect(p1Data).toEqual({ dayNumber: 1 });
    });

    it('cannot end the day from night phase', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      state = { ...state, players: makePlayers(5), phase: 'night' };

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      state = { ...state, storytellerId: storyteller.id! };
      store.games.set(gameId, state);

      const errorPromise = waitForEvent(storyteller, 'end_day_error');
      storyteller.emit('end_day', { gameId });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Can only end the day during the day phase');
    });
  });
});
