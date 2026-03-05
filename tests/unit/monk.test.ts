import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  processMonkAction,
  processImpAction,
  transitionToNight,
  buildAbilityContext,
  getNightPromptInfo,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { abilityHandler } from '../../src/roles/monk.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import { NIGHT_1_ORDER, NIGHT_OTHER_ORDER } from '../../src/data/nightOrder.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'washerwoman',
    apparentRole: 'washerwoman',
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex: 0,
    ...overrides,
  };
}

function makeGameWithPlayers(): GameState {
  let state = createInitialGameState('g1', 'ABC123', 'st1');
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'monk', apparentRole: 'monk', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  return state;
}

describe('Monk', () => {
  describe('night order', () => {
    it('Monk is not in Night 1 order', () => {
      expect(NIGHT_1_ORDER).not.toContain('monk');
    });

    it('Monk is in other nights order', () => {
      expect(NIGHT_OTHER_ORDER).toContain('monk');
    });

    it('Monk acts before the Imp in night order', () => {
      const monkIndex = NIGHT_OTHER_ORDER.indexOf('monk');
      const impIndex = NIGHT_OTHER_ORDER.indexOf('imp');
      expect(monkIndex).toBeLessThan(impIndex);
    });
  });

  describe('night prompt', () => {
    it('Monk prompt is choose_player type with correct description', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
        nightQueue: [
          { roleId: 'monk' as RoleId, playerId: 'p1', completed: false },
        ],
        nightQueuePosition: 0,
      };

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.promptType).toBe('choose_player');
      expect(prompt!.promptDescription).toContain('Monk');
      expect(prompt!.promptDescription).toContain('protect');
    });
  });

  describe('state machine', () => {
    it('processMonkAction sets monkProtectedPlayerId', () => {
      const state = makeGameWithPlayers();
      const result = processMonkAction(state, 'p3');

      expect(result.monkProtectedPlayerId).toBe('p3');
    });

    it('processMonkAction logs the action', () => {
      const state = makeGameWithPlayers();
      const result = processMonkAction(state, 'p3');

      const logEntry = result.gameLog.find((l) => l.type === 'monk_action');
      expect(logEntry).toBeDefined();
      expect((logEntry!.data as { targetPlayerId: string }).targetPlayerId).toBe('p3');
    });

    it('processMonkAction returns same state for invalid target', () => {
      const state = makeGameWithPlayers();
      const result = processMonkAction(state, 'nonexistent');
      expect(result).toBe(state);
    });

    it('Monk protection prevents Imp kill', () => {
      let state = makeGameWithPlayers();
      state = processMonkAction(state, 'p3');
      const result = processImpAction(state, 'p3', 'p2');

      expect(result.pendingDeaths).not.toContain('p3');
      const blockLog = result.gameLog.find((l) => l.type === 'imp_kill_blocked');
      expect(blockLog).toBeDefined();
      expect((blockLog!.data as { reason: string }).reason).toBe('monk_protection');
    });

    it('Monk protection does not prevent kill of unprotected player', () => {
      let state = makeGameWithPlayers();
      state = processMonkAction(state, 'p3');
      const result = processImpAction(state, 'p4', 'p2');

      expect(result.pendingDeaths).toContain('p4');
    });

    it('monkProtectedPlayerId is cleared at start of each night', () => {
      let state = makeGameWithPlayers();
      state = { ...state, phase: 'day' as const, daySubPhase: 'end', monkProtectedPlayerId: 'p3', dayNumber: 1 };
      const nightState = transitionToNight(state);

      expect(nightState.monkProtectedPlayerId).toBeNull();
    });
  });

  describe('ability handler', () => {
    it('returns success with target info', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        targetPlayerId: 'p3',
        effective: true,
        isCorrupted: false,
      });
    });

    it('fails if no target selected', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('No target');
    });

    it('fails if target not found', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('fails if target is dead', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p3' ? { ...p, isAlive: false } : p)),
      };
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not alive');
    });

    it('fails if Monk targets themselves', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p1' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('cannot protect themselves');
    });

    it('when poisoned, marks as corrupted and ineffective', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p1' ? { ...p, isPoisoned: true } : p)),
      };
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        targetPlayerId: 'p3',
        effective: false,
        isCorrupted: true,
      });
    });

    it('when drunk, marks as corrupted and ineffective', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p1' ? { ...p, isDrunk: true } : p)),
      };
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        targetPlayerId: 'p3',
        effective: false,
        isCorrupted: true,
      });
    });
  });

  describe('WebSocket', () => {
    let store: GameStore;
    let httpServer: ReturnType<typeof createServer>;
    let ioServer: Server;
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

    it('Storyteller can submit Monk night action and protection is set', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'monk', apparentRole: 'monk', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'monk' as RoleId, playerId: storyteller.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });

      await confirmPromise;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.monkProtectedPlayerId).toBe('p3');
    });

    it('Monk protection blocks Imp kill via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'monk', apparentRole: 'monk', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'monk' as RoleId, playerId: storyteller.id!, completed: false },
          { roleId: 'imp' as RoleId, playerId: 'p2', completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      // Submit Monk protection on p3
      const monkConfirm = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });
      await monkConfirm;

      // Submit Imp kill on p3 (should be blocked)
      const impConfirm = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });
      await impConfirm;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.pendingDeaths).not.toContain('p3');
    });

    it('Poisoned Monk protection has no effect via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'monk', apparentRole: 'monk', seatIndex: 0, isPoisoned: true }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'monk' as RoleId, playerId: storyteller.id!, completed: false },
          { roleId: 'imp' as RoleId, playerId: 'p2', completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      // Submit Monk protection on p3 (poisoned, should not set protection)
      const monkConfirm = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });
      await monkConfirm;

      // Verify monkProtectedPlayerId is NOT set (poisoned Monk has no effect)
      const afterMonk = store.games.get(gameId)!;
      expect(afterMonk.monkProtectedPlayerId).toBeNull();

      // Submit Imp kill on p3 (should succeed since Monk was poisoned)
      const impConfirm = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });
      await impConfirm;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.pendingDeaths).toContain('p3');
    });

    it('Monk protection clears at night transition via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'monk', apparentRole: 'monk', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let dayState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'day' as const,
        daySubPhase: 'end' as const,
        dayNumber: 2,
        monkProtectedPlayerId: 'p3',
      };
      store.games.set(gameId, dayState);

      const nightStarted = waitForEvent(storyteller, 'night_started');
      storyteller.emit('end_day', { gameId });
      await nightStarted;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.monkProtectedPlayerId).toBeNull();
    });
  });
});
