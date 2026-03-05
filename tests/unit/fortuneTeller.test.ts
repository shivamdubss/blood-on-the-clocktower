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
import { abilityHandler } from '../../src/roles/fortuneTeller.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import type { AbilityResult } from '../../src/types/ability.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'fortuneTeller',
    apparentRole: 'fortuneTeller',
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
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'empath', apparentRole: 'empath', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }));
  return state;
}

describe('Fortune Teller', () => {
  describe('night order', () => {
    it('fires on Night 1 (present in NIGHT_1_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      const ftEntry = state.nightQueue.find((e) => e.roleId === 'fortuneTeller');
      expect(ftEntry).toBeDefined();
      expect(ftEntry!.playerId).toBe('p3');
    });

    it('fires on Night 2+ (present in NIGHT_OTHER_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const ftEntry = state.nightQueue.find((e) => e.roleId === 'fortuneTeller');
      expect(ftEntry).toBeDefined();
      expect(ftEntry!.playerId).toBe('p3');
    });
  });

  describe('night prompt', () => {
    it('Storyteller is prompted with choose_two_players prompt type', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'fortuneTeller') {
          expect(prompt.promptType).toBe('choose_two_players');
          expect(prompt.promptDescription).toContain('Fortune Teller');
          expect(prompt.promptDescription).toContain('Demon');
          expect(prompt.playerId).toBe('p3');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Fortune Teller prompt not found in night queue');
    });
  });

  describe('ability handler', () => {
    it('returns success with yes answer when target is the Demon', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p2', player2Id: 'p4', answer: true }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { player1Id: string; player1Name: string; player2Id: string; player2Name: string; answer: boolean; isCorrupted: boolean };
      expect(data.player1Id).toBe('p2');
      expect(data.player1Name).toBe('Bob');
      expect(data.player2Id).toBe('p4');
      expect(data.player2Name).toBe('Diana');
      expect(data.answer).toBe(true);
      expect(data.isCorrupted).toBe(false);
    });

    it('returns success with no answer when neither is the Demon', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p4', player2Id: 'p5', answer: false }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { answer: boolean; isCorrupted: boolean };
      expect(data.answer).toBe(false);
      expect(data.isCorrupted).toBe(false);
    });

    it('returns yes when one of the chosen players is the red herring', () => {
      let state = makeGameWithPlayers();
      // Set p4 (Diana, Washerwoman, Good) as the red herring
      state = { ...state, fortuneTellerRedHerringId: 'p4' };
      const context = buildAbilityContext(state, 'p3', 1);
      // Storyteller indicates yes because p4 is the red herring
      const result = abilityHandler(context, { player1Id: 'p4', player2Id: 'p5', answer: true }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { answer: boolean; isCorrupted: boolean };
      expect(data.answer).toBe(true);
      expect(data.isCorrupted).toBe(false);
    });

    it('red herring returns yes even if dead', () => {
      let state = makeGameWithPlayers();
      state = { ...state, fortuneTellerRedHerringId: 'p4' };
      // Kill the red herring
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p4' ? { ...p, isAlive: false } : p)),
      };
      const context = buildAbilityContext(state, 'p3', 2);
      // Storyteller still indicates yes because p4 is the red herring (even though dead)
      const result = abilityHandler(context, { player1Id: 'p4', player2Id: 'p5', answer: true }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { answer: boolean };
      expect(data.answer).toBe(true);
    });

    it('Recluse may register as Demon at Storyteller discretion', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'imp', apparentRole: 'imp', seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }));

      const context = buildAbilityContext(state, 'p2', 1);
      // Storyteller decides Recluse (p1) registers as Demon, so answer is yes
      const result = abilityHandler(context, { player1Id: 'p1', player2Id: 'p4', answer: true }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { answer: boolean; isCorrupted: boolean };
      expect(data.answer).toBe(true);
      expect(data.isCorrupted).toBe(false);
    });

    it('returns failure when player1Id is missing', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player2Id: 'p4', answer: true }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when player2Id is missing', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p2', answer: true }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when answer is missing', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p2', player2Id: 'p4' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when no input provided', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, undefined) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when player IDs are invalid', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'invalid', player2Id: 'p4', answer: true }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('marks isCorrupted true when poisoned', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p3');
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p2', player2Id: 'p4', answer: false }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { isCorrupted: boolean };
      expect(data.isCorrupted).toBe(true);
    });

    it('marks isCorrupted true when drunk (may return false information)', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const drunkContext = { ...context, isDrunk: true };
      // Storyteller provides false answer (true when no Demon is chosen)
      const result = abilityHandler(drunkContext, { player1Id: 'p4', player2Id: 'p5', answer: true }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { answer: boolean; isCorrupted: boolean };
      expect(data.answer).toBe(true);
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

    it('player receives night_info with answer via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const ftPlayer = createClient();
      await new Promise<void>((resolve) => ftPlayer.on('connect', resolve));
      ftPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'FTPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: ftPlayer.id!, name: 'FTPlayer', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 2 }),
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
          { roleId: 'fortuneTeller' as RoleId, playerId: ftPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(ftPlayer, 'night_info');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { player1Id: 'p2', player2Id: 'p4', answer: true },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      await confirmPromise;

      expect(nightInfo.roleId).toBe('fortuneTeller');
      expect(nightInfo.player1Id).toBe('p2');
      expect(nightInfo.player1Name).toBe('Bob');
      expect(nightInfo.player2Id).toBe('p4');
      expect(nightInfo.player2Name).toBe('Diana');
      expect(nightInfo.answer).toBe(true);
    });

    it('Fortune Teller receives no answer via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const ftPlayer = createClient();
      await new Promise<void>((resolve) => ftPlayer.on('connect', resolve));
      ftPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'FTPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: ftPlayer.id!, name: 'FTPlayer', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 2 }),
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
          { roleId: 'fortuneTeller' as RoleId, playerId: ftPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(ftPlayer, 'night_info');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { player1Id: 'p4', player2Id: 'p5', answer: false },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      expect(nightInfo.roleId).toBe('fortuneTeller');
      expect(nightInfo.answer).toBe(false);
    });

    it('Fortune Teller poisoned: Storyteller provides false info (still delivered)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const ftPlayer = createClient();
      await new Promise<void>((resolve) => ftPlayer.on('connect', resolve));
      ftPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'FTPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: ftPlayer.id!, name: 'FTPlayer', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 2, isPoisoned: true }),
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
          { roleId: 'fortuneTeller' as RoleId, playerId: ftPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(ftPlayer, 'night_info');

      // Storyteller provides false info (true even though neither is Demon)
      storyteller.emit('submit_night_action', {
        gameId,
        input: { player1Id: 'p4', player2Id: 'p5', answer: true },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      expect(nightInfo.roleId).toBe('fortuneTeller');
      expect(nightInfo.answer).toBe(true);
    });

    it('Fortune Teller night prompt flags isPoisoned to Storyteller', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      state = poisonPlayer(state, 'p3');

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'fortuneTeller') {
          expect(prompt.isPoisoned).toBe(true);
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Fortune Teller prompt not found');
    });

    it('Fortune Teller night prompt shows isDrunk when Drunk has Fortune Teller apparent role', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'drunk', apparentRole: 'fortuneTeller', isDrunk: true, seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.playerId === 'p3') {
          expect(prompt.isDrunk).toBe(true);
          expect(prompt.roleId).toBe('fortuneTeller');
          expect(prompt.promptDescription).toContain('DRUNK');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Drunk-as-Fortune-Teller prompt not found');
    });
  });
});
