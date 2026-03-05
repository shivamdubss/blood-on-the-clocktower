import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  transitionToNight,
  buildAbilityContext,
  advanceNightQueue,
  getNightPromptInfo,
  poisonPlayer,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { abilityHandler } from '../../src/roles/undertaker.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import type { AbilityResult } from '../../src/types/ability.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'undertaker',
    apparentRole: 'undertaker',
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
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'undertaker', apparentRole: 'undertaker', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }));
  return state;
}

describe('Undertaker', () => {
  describe('night order', () => {
    it('does NOT fire on Night 1 (not in NIGHT_1_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      const undertakerEntry = state.nightQueue.find((e) => e.roleId === 'undertaker');
      expect(undertakerEntry).toBeUndefined();
    });

    it('fires on Night 2+ (present in NIGHT_OTHER_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const undertakerEntry = state.nightQueue.find((e) => e.roleId === 'undertaker');
      expect(undertakerEntry).toBeDefined();
      expect(undertakerEntry!.playerId).toBe('p3');
    });
  });

  describe('night prompt', () => {
    it('Storyteller is prompted with provide_role prompt type', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'undertaker') {
          expect(prompt.promptType).toBe('provide_role');
          expect(prompt.promptDescription).toContain('Undertaker');
          expect(prompt.promptDescription).toContain('executed');
          expect(prompt.playerId).toBe('p3');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Undertaker prompt not found');
    });

    it('Undertaker prompt includes executed player info when execution occurred', () => {
      let state = makeGameWithPlayers();
      // Simulate an execution in the game log
      state = {
        ...state,
        dayNumber: 1,
        gameLog: [
          ...state.gameLog,
          { timestamp: Date.now(), type: 'execution', data: { playerId: 'p4', voteCount: 3 } },
        ],
      };
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'undertaker') {
          expect(prompt.executedPlayerInfo).toBeDefined();
          expect(prompt.executedPlayerInfo!.playerId).toBe('p4');
          expect(prompt.executedPlayerInfo!.playerName).toBe('Diana');
          expect(prompt.executedPlayerInfo!.trueRole).toBe('empath');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Undertaker prompt not found');
    });

    it('Undertaker prompt has no executedPlayerInfo when no execution occurred', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        dayNumber: 1,
        gameLog: [
          ...state.gameLog,
          { timestamp: Date.now(), type: 'no_execution', data: {} },
        ],
      };
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'undertaker') {
          expect(prompt.executedPlayerInfo).toBeUndefined();
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Undertaker prompt not found');
    });
  });

  describe('ability handler', () => {
    it('returns role info when Storyteller provides executed player role', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, { role: 'imp' });
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).role).toBe('imp');
      expect((result.data as Record<string, unknown>).isCorrupted).toBe(false);
    });

    it('returns noExecution when no execution occurred', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, { noExecution: true });
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).noExecution).toBe(true);
    });

    it('fails validation when no role or noExecution provided', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('Must provide a role');
    });

    it('fails validation when role is not a string', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, { role: 123 });
      expect(result.success).toBe(false);
    });

    it('fails validation with no input', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, undefined);
      expect(result.success).toBe(false);
    });

    it('accepts any valid role string (Storyteller may provide false info)', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, { role: 'washerwoman' });
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).role).toBe('washerwoman');
    });

    it('sets isCorrupted when Undertaker is poisoned', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      state = poisonPlayer(state, 'p3');
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, { role: 'imp' });
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.isCorrupted).toBe(true);
    });

    it('sets isCorrupted when Undertaker is drunk', () => {
      let state = makeGameWithPlayers();
      // Replace undertaker with drunk who has undertaker apparent role
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p3' ? { ...p, trueRole: 'drunk' as RoleId, apparentRole: 'undertaker' as RoleId, isDrunk: true } : p
        ),
        dayNumber: 1,
      };
      state = transitionToNight(state);
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, { role: 'baron' });
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.isCorrupted).toBe(true);
    });

    it('sets isCorrupted for noExecution when poisoned', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      state = poisonPlayer(state, 'p3');
      const ctx = buildAbilityContext(state, 'p3', 2);
      const result = abilityHandler(ctx, { noExecution: true });
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.noExecution).toBe(true);
      expect(data.isCorrupted).toBe(true);
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

    it('player receives night_info with executed role via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const undertakerPlayer = createClient();
      await new Promise<void>((resolve) => undertakerPlayer.on('connect', resolve));
      undertakerPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'UndertakerPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: undertakerPlayer.id!, name: 'UndertakerPlayer', trueRole: 'undertaker', apparentRole: 'undertaker', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 1,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'undertaker' as RoleId, playerId: undertakerPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(undertakerPlayer, 'night_info');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { role: 'imp' },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      await confirmPromise;

      expect(nightInfo.roleId).toBe('undertaker');
      expect(nightInfo.role).toBe('imp');
    });

    it('player receives night_info with noExecution via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const undertakerPlayer = createClient();
      await new Promise<void>((resolve) => undertakerPlayer.on('connect', resolve));
      undertakerPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'UndertakerPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: undertakerPlayer.id!, name: 'UndertakerPlayer', trueRole: 'undertaker', apparentRole: 'undertaker', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 1,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'undertaker' as RoleId, playerId: undertakerPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(undertakerPlayer, 'night_info');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { noExecution: true },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      expect(nightInfo.roleId).toBe('undertaker');
      expect(nightInfo.noExecution).toBe(true);
    });

    it('Storyteller provides false role when Undertaker is poisoned (info still delivered)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const undertakerPlayer = createClient();
      await new Promise<void>((resolve) => undertakerPlayer.on('connect', resolve));
      undertakerPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'UndertakerPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: undertakerPlayer.id!, name: 'UndertakerPlayer', trueRole: 'undertaker', apparentRole: 'undertaker', seatIndex: 2, isPoisoned: true }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 1,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'undertaker' as RoleId, playerId: undertakerPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(undertakerPlayer, 'night_info');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { role: 'washerwoman' },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      expect(nightInfo.roleId).toBe('undertaker');
      expect(nightInfo.role).toBe('washerwoman');
    });

    it('Undertaker night prompt flags isPoisoned to Storyteller', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      state = poisonPlayer(state, 'p3');

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'undertaker') {
          expect(prompt.isPoisoned).toBe(true);
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Undertaker prompt not found');
    });

    it('Undertaker night prompt shows isDrunk when Drunk has Undertaker apparent role', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'drunk', apparentRole: 'undertaker', isDrunk: true, seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }));
      state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 5 }));
      state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }));
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.playerId === 'p3') {
          expect(prompt.isDrunk).toBe(true);
          expect(prompt.roleId).toBe('undertaker');
          expect(prompt.promptDescription).toContain('DRUNK');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Drunk-as-Undertaker prompt not found');
    });
  });
});
