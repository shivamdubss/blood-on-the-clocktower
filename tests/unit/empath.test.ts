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
import { abilityHandler } from '../../src/roles/empath.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import type { AbilityResult } from '../../src/types/ability.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'empath',
    apparentRole: 'empath',
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
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'empath', apparentRole: 'empath', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }));
  return state;
}

describe('Empath', () => {
  describe('night order', () => {
    it('fires on Night 1 (present in NIGHT_1_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      const empathEntry = state.nightQueue.find((e) => e.roleId === 'empath');
      expect(empathEntry).toBeDefined();
      expect(empathEntry!.playerId).toBe('p3');
    });

    it('fires on Night 2+ (present in NIGHT_OTHER_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const empathEntry = state.nightQueue.find((e) => e.roleId === 'empath');
      expect(empathEntry).toBeDefined();
      expect(empathEntry!.playerId).toBe('p3');
    });
  });

  describe('night prompt', () => {
    it('Storyteller is prompted with provide_number prompt type', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'empath') {
          expect(prompt.promptType).toBe('provide_number');
          expect(prompt.promptDescription).toContain('Empath');
          expect(prompt.promptDescription).toContain('evil alive neighbours');
          expect(prompt.playerId).toBe('p3');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Empath prompt not found in night queue');
    });
  });

  describe('ability handler', () => {
    it('returns success with the provided number', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { number: 1 }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { number: number; isCorrupted: boolean };
      expect(data.number).toBe(1);
      expect(data.isCorrupted).toBe(false);
    });

    it('returns 0 when no evil neighbours', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { number: 0 }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { number: number };
      expect(data.number).toBe(0);
    });

    it('returns 2 when both neighbours are evil', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { number: 2 }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { number: number };
      expect(data.number).toBe(2);
    });

    it('returns failure when number is missing', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, {}) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when no input provided', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, undefined) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when number is not a number type', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { number: 'two' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('neighbours are computed dynamically -- dead neighbour skipped to next living player', () => {
      // Empath (p3, seat 2) has neighbours p2 (seat 1, Imp) and p4 (seat 3, Washerwoman)
      // If p2 dies, the next living player in that direction (p1, seat 0, Poisoner) becomes the neighbour
      // Storyteller computes and provides the number based on current alive state
      let state = makeGameWithPlayers();
      // Kill p2 (Imp, direct left neighbour)
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p2' ? { ...p, isAlive: false } : p)),
      };
      const context = buildAbilityContext(state, 'p3', 2);
      // Now p1 (Poisoner, evil) is left neighbour, p4 (Washerwoman, good) is right neighbour
      // Storyteller provides 1 (one evil alive neighbour)
      const result = abilityHandler(context, { number: 1 }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { number: number; isCorrupted: boolean };
      expect(data.number).toBe(1);
      expect(data.isCorrupted).toBe(false);
    });

    it('Recluse may register as Evil at Storyteller discretion', () => {
      // Replace a player with Recluse as an alive neighbour
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'empath', apparentRole: 'empath', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'imp', apparentRole: 'imp', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }));

      const context = buildAbilityContext(state, 'p2', 1);
      // Storyteller decides Recluse (p1) registers as evil, so count is 1 (Recluse)
      // rather than 0 (neither actual neighbour is evil - Recluse is Good, Washerwoman is Good)
      const result = abilityHandler(context, { number: 1 }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { number: number };
      expect(data.number).toBe(1);
    });

    it('marks isCorrupted true when poisoned', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p3');
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { number: 0 }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { isCorrupted: boolean };
      expect(data.isCorrupted).toBe(true);
    });

    it('marks isCorrupted true when drunk (returns false number)', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const drunkContext = { ...context, isDrunk: true };
      const result = abilityHandler(drunkContext, { number: 5 }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { number: number; isCorrupted: boolean };
      expect(data.number).toBe(5);
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

    it('player receives night_info with evil neighbour count via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const empathPlayer = createClient();
      await new Promise<void>((resolve) => empathPlayer.on('connect', resolve));
      empathPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'EmpathPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: empathPlayer.id!, name: 'EmpathPlayer', trueRole: 'empath', apparentRole: 'empath', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 0,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'empath' as RoleId, playerId: empathPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(empathPlayer, 'night_info');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { number: 1 },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      await confirmPromise;

      expect(nightInfo.roleId).toBe('empath');
      expect(nightInfo.number).toBe(1);
    });

    it('Storyteller provides false number when Empath is poisoned (info still delivered)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const empathPlayer = createClient();
      await new Promise<void>((resolve) => empathPlayer.on('connect', resolve));
      empathPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'EmpathPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: empathPlayer.id!, name: 'EmpathPlayer', trueRole: 'empath', apparentRole: 'empath', seatIndex: 2, isPoisoned: true }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 0,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'empath' as RoleId, playerId: empathPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(empathPlayer, 'night_info');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { number: 5 },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      expect(nightInfo.roleId).toBe('empath');
      expect(nightInfo.number).toBe(5);
    });

    it('Empath night prompt flags isPoisoned to Storyteller', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      state = poisonPlayer(state, 'p3');

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'empath') {
          expect(prompt.isPoisoned).toBe(true);
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Empath prompt not found');
    });

    it('Empath night prompt shows isDrunk when Drunk has Empath apparent role', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'drunk', apparentRole: 'empath', isDrunk: true, seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.playerId === 'p3') {
          expect(prompt.isDrunk).toBe(true);
          expect(prompt.roleId).toBe('empath');
          expect(prompt.promptDescription).toContain('DRUNK');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Drunk-as-Empath prompt not found');
    });

    it('Empath info delivery with zero evil neighbours', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const empathPlayer = createClient();
      await new Promise<void>((resolve) => empathPlayer.on('connect', resolve));
      empathPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'EmpathPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: empathPlayer.id!, name: 'EmpathPlayer', trueRole: 'empath', apparentRole: 'empath', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 0,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'empath' as RoleId, playerId: empathPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(empathPlayer, 'night_info');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { number: 0 },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      expect(nightInfo.roleId).toBe('empath');
      expect(nightInfo.number).toBe(0);
    });
  });
});
