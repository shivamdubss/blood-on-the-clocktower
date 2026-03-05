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
import { abilityHandler } from '../../src/roles/librarian.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import type { AbilityResult } from '../../src/types/ability.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'librarian',
    apparentRole: 'librarian',
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
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'librarian', apparentRole: 'librarian', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'butler', apparentRole: 'butler', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'empath', apparentRole: 'empath', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'chef', apparentRole: 'chef', seatIndex: 6 }));
  return state;
}

function makeGameWithoutOutsiders(): GameState {
  let state = createInitialGameState('g1', 'ABC123', 'st1');
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'librarian', apparentRole: 'librarian', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  return state;
}

describe('Librarian', () => {
  describe('night order', () => {
    it('fires on Night 1 only (present in NIGHT_1_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      const libEntry = state.nightQueue.find((e) => e.roleId === 'librarian');
      expect(libEntry).toBeDefined();
      expect(libEntry!.playerId).toBe('p3');
    });

    it('does not fire on Night 2+', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const libEntry = state.nightQueue.find((e) => e.roleId === 'librarian');
      expect(libEntry).toBeUndefined();
    });
  });

  describe('night prompt', () => {
    it('Storyteller is prompted to choose two players and an Outsider role', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'librarian') {
          expect(prompt.promptType).toBe('choose_players_and_role');
          expect(prompt.promptDescription).toContain('Librarian');
          expect(prompt.promptDescription).toContain('2 players');
          expect(prompt.promptDescription).toContain('Outsider');
          expect(prompt.playerId).toBe('p3');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Librarian prompt not found in night queue');
    });
  });

  describe('ability handler', () => {
    it('returns success with two players and a revealed Outsider role', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, {
        player1Id: 'p4',
        player2Id: 'p5',
        revealedRole: 'butler',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { player1Id: string; player2Id: string; revealedRole: string; isCorrupted: boolean };
      expect(data.player1Id).toBe('p4');
      expect(data.player2Id).toBe('p5');
      expect(data.revealedRole).toBe('butler');
      expect(data.isCorrupted).toBe(false);
    });

    it('one of the two players must actually be that Outsider role (Storyteller provides valid input)', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      // Diana (p4) IS the butler, so this is valid Storyteller input
      const result = abilityHandler(context, {
        player1Id: 'p4',
        player2Id: 'p6',
        revealedRole: 'butler',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { player1Name: string; player2Name: string; revealedRole: string };
      expect(data.player1Name).toBe('Diana');
      expect(data.player2Name).toBe('Frank');
      expect(data.revealedRole).toBe('butler');
    });

    it('handles noOutsiders flag when no Outsiders are in the game', () => {
      const state = makeGameWithoutOutsiders();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { noOutsiders: true }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { noOutsiders: boolean; isCorrupted: boolean };
      expect(data.noOutsiders).toBe(true);
      expect(data.isCorrupted).toBe(false);
    });

    it('returns failure when missing player1Id', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player2Id: 'p5', revealedRole: 'butler' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when missing player2Id', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p4', revealedRole: 'butler' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when missing revealedRole', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p4', player2Id: 'p5' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure for invalid player IDs', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, {
        player1Id: 'nonexistent',
        player2Id: 'p5',
        revealedRole: 'butler',
      }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when no input provided', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, undefined) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('marks isCorrupted true when poisoned', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p3');
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, {
        player1Id: 'p4',
        player2Id: 'p5',
        revealedRole: 'butler',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { isCorrupted: boolean };
      expect(data.isCorrupted).toBe(true);
    });

    it('marks isCorrupted true when drunk', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const drunkContext = { ...context, isDrunk: true };
      const result = abilityHandler(drunkContext, {
        player1Id: 'p4',
        player2Id: 'p5',
        revealedRole: 'butler',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { isCorrupted: boolean };
      expect(data.isCorrupted).toBe(true);
    });

    it('marks isCorrupted true on noOutsiders when poisoned', () => {
      let state = makeGameWithoutOutsiders();
      state = poisonPlayer(state, 'p3');
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { noOutsiders: true }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { noOutsiders: boolean; isCorrupted: boolean };
      expect(data.noOutsiders).toBe(true);
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

    it('player receives night_info with two players and an Outsider role via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const libPlayer = createClient();
      await new Promise<void>((resolve) => libPlayer.on('connect', resolve));
      libPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'LibPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: libPlayer.id!, name: 'LibPlayer', trueRole: 'librarian', apparentRole: 'librarian', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'butler', apparentRole: 'butler', seatIndex: 3 }),
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
          { roleId: 'librarian' as RoleId, playerId: libPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(libPlayer, 'night_info');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { player1Id: 'p4', player2Id: 'p5', revealedRole: 'butler' },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      await confirmPromise;

      expect(nightInfo.roleId).toBe('librarian');
      expect(nightInfo.player1Id).toBe('p4');
      expect(nightInfo.player1Name).toBe('Diana');
      expect(nightInfo.player2Id).toBe('p5');
      expect(nightInfo.player2Name).toBe('Eve');
      expect(nightInfo.revealedRole).toBe('butler');
    });

    it('player receives night_info with noOutsiders flag when no Outsiders in game', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const libPlayer = createClient();
      await new Promise<void>((resolve) => libPlayer.on('connect', resolve));
      libPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'LibPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: libPlayer.id!, name: 'LibPlayer', trueRole: 'librarian', apparentRole: 'librarian', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
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
          { roleId: 'librarian' as RoleId, playerId: libPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(libPlayer, 'night_info');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { noOutsiders: true },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;

      expect(nightInfo.roleId).toBe('librarian');
      expect(nightInfo.noOutsiders).toBe(true);
    });

    it('Storyteller provides false info when Librarian is poisoned (info still delivered)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const libPlayer = createClient();
      await new Promise<void>((resolve) => libPlayer.on('connect', resolve));
      libPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'LibPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: libPlayer.id!, name: 'LibPlayer', trueRole: 'librarian', apparentRole: 'librarian', seatIndex: 2, isPoisoned: true }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
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
          { roleId: 'librarian' as RoleId, playerId: libPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(libPlayer, 'night_info');

      // Storyteller deliberately gives false info since Librarian is poisoned
      storyteller.emit('submit_night_action', {
        gameId,
        input: { player1Id: 'p4', player2Id: 'p5', revealedRole: 'recluse' },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;

      expect(nightInfo.roleId).toBe('librarian');
      expect(nightInfo.revealedRole).toBe('recluse');
    });

    it('Librarian night prompt flags isPoisoned to Storyteller', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      state = poisonPlayer(state, 'p3');

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'librarian') {
          expect(prompt.isPoisoned).toBe(true);
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Librarian prompt not found');
    });

    it('Librarian night prompt shows isDrunk when Drunk has Librarian apparent role', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'drunk', apparentRole: 'librarian', isDrunk: true, seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.playerId === 'p3') {
          expect(prompt.isDrunk).toBe(true);
          expect(prompt.roleId).toBe('librarian');
          expect(prompt.promptDescription).toContain('DRUNK');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Drunk-as-Librarian prompt not found');
    });
  });
});
