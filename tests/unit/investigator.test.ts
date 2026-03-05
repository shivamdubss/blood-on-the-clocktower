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
import { abilityHandler } from '../../src/roles/investigator.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import type { AbilityResult } from '../../src/types/ability.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'investigator',
    apparentRole: 'investigator',
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
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'investigator', apparentRole: 'investigator', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }));
  return state;
}

describe('Investigator', () => {
  describe('night order', () => {
    it('fires on Night 1 only (present in NIGHT_1_ORDER, not NIGHT_OTHER_ORDER)', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      const entry = state.nightQueue.find((e) => e.roleId === 'investigator');
      expect(entry).toBeDefined();
      expect(entry!.playerId).toBe('p3');
    });

    it('does not fire on Night 2+', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);
      const entry = state.nightQueue.find((e) => e.roleId === 'investigator');
      expect(entry).toBeUndefined();
    });
  });

  describe('night prompt', () => {
    it('Storyteller is prompted to choose two players and a Minion role', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'investigator') {
          expect(prompt.promptType).toBe('choose_players_and_role');
          expect(prompt.promptDescription).toContain('Investigator');
          expect(prompt.promptDescription).toContain('2 players');
          expect(prompt.promptDescription).toContain('Minion');
          expect(prompt.playerId).toBe('p3');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Investigator prompt not found in night queue');
    });
  });

  describe('ability handler', () => {
    it('returns success with two players and a revealed Minion role', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, {
        player1Id: 'p1',
        player2Id: 'p4',
        revealedRole: 'poisoner',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { player1Id: string; player2Id: string; revealedRole: string; isCorrupted: boolean };
      expect(data.player1Id).toBe('p1');
      expect(data.player2Id).toBe('p4');
      expect(data.revealedRole).toBe('poisoner');
      expect(data.isCorrupted).toBe(false);
    });

    it('one of the two players must actually be that Minion role (Storyteller provides valid input)', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      // Alice (p1) IS the poisoner, so this is valid Storyteller input
      const result = abilityHandler(context, {
        player1Id: 'p1',
        player2Id: 'p4',
        revealedRole: 'poisoner',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { player1Id: string; player1Name: string; player2Id: string; player2Name: string; revealedRole: string };
      expect(data.player1Name).toBe('Alice');
      expect(data.player2Name).toBe('Diana');
      expect(data.revealedRole).toBe('poisoner');
    });

    it('Recluse may be shown as the Minion (Storyteller chooses Recluse as one of the two players)', () => {
      // Add a Recluse to the game
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'investigator', apparentRole: 'investigator', seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));

      const context = buildAbilityContext(state, 'p3', 1);
      // Storyteller includes Recluse (p4) as one of the players and shows her as poisoner
      const result = abilityHandler(context, {
        player1Id: 'p4',
        player2Id: 'p5',
        revealedRole: 'poisoner',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { player1Id: string; player1Name: string; revealedRole: string };
      expect(data.player1Name).toBe('Diana');
      expect(data.revealedRole).toBe('poisoner');
    });

    it('returns failure when missing player1Id', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player2Id: 'p5', revealedRole: 'poisoner' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when missing player2Id', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p1', revealedRole: 'poisoner' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure when missing revealedRole', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, { player1Id: 'p1', player2Id: 'p5' }) as AbilityResult;
      expect(result.success).toBe(false);
    });

    it('returns failure for invalid player IDs', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);
      const result = abilityHandler(context, {
        player1Id: 'nonexistent',
        player2Id: 'p5',
        revealedRole: 'poisoner',
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
        player1Id: 'p1',
        player2Id: 'p4',
        revealedRole: 'poisoner',
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
        player1Id: 'p1',
        player2Id: 'p4',
        revealedRole: 'poisoner',
      }) as AbilityResult;

      expect(result.success).toBe(true);
      const data = result.data as { isCorrupted: boolean };
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

    it('player receives night_info with two players and a Minion role via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const invPlayer = createClient();
      await new Promise<void>((resolve) => invPlayer.on('connect', resolve));
      invPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'InvPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'empath', apparentRole: 'empath', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: invPlayer.id!, name: 'InvPlayer', trueRole: 'investigator', apparentRole: 'investigator', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'imp', apparentRole: 'imp', seatIndex: 3 }),
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
          { roleId: 'investigator' as RoleId, playerId: invPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(invPlayer, 'night_info');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      // Storyteller submits Investigator info: Bob and Diana, revealing poisoner
      storyteller.emit('submit_night_action', {
        gameId,
        input: { player1Id: 'p2', player2Id: 'p4', revealedRole: 'poisoner' },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;
      await confirmPromise;

      expect(nightInfo.roleId).toBe('investigator');
      expect(nightInfo.player1Id).toBe('p2');
      expect(nightInfo.player1Name).toBe('Bob');
      expect(nightInfo.player2Id).toBe('p4');
      expect(nightInfo.player2Name).toBe('Diana');
      expect(nightInfo.revealedRole).toBe('poisoner');
    });

    it('Storyteller provides false info when Investigator is poisoned (info still delivered)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const invPlayer = createClient();
      await new Promise<void>((resolve) => invPlayer.on('connect', resolve));
      invPlayer.emit('join_game', { joinCode: 'ABC123', playerName: 'InvPlayer' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'empath', apparentRole: 'empath', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: invPlayer.id!, name: 'InvPlayer', trueRole: 'investigator', apparentRole: 'investigator', seatIndex: 2, isPoisoned: true }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'imp', apparentRole: 'imp', seatIndex: 3 }),
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
          { roleId: 'investigator' as RoleId, playerId: invPlayer.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(invPlayer, 'night_info');

      // Storyteller deliberately gives false info (wrong role) since Investigator is poisoned
      storyteller.emit('submit_night_action', {
        gameId,
        input: { player1Id: 'p4', player2Id: 'p5', revealedRole: 'scarletWoman' },
      });

      const nightInfo = await nightInfoPromise as Record<string, unknown>;

      expect(nightInfo.roleId).toBe('investigator');
      expect(nightInfo.revealedRole).toBe('scarletWoman');
    });

    it('Investigator night prompt flags isPoisoned to Storyteller', async () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      state = poisonPlayer(state, 'p3'); // Poison the Investigator

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.roleId === 'investigator') {
          expect(prompt.isPoisoned).toBe(true);
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Investigator prompt not found');
    });

    it('Investigator night prompt shows isDrunk when Drunk has Investigator apparent role', async () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
      state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
      state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'drunk', apparentRole: 'investigator', isDrunk: true, seatIndex: 2 }));
      state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
      state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
      state = transitionToNight(state);

      while (state.nightQueuePosition < state.nightQueue.length) {
        const prompt = getNightPromptInfo(state);
        if (prompt && prompt.playerId === 'p3') {
          expect(prompt.isDrunk).toBe(true);
          expect(prompt.roleId).toBe('investigator');
          expect(prompt.promptDescription).toContain('DRUNK');
          return;
        }
        state = advanceNightQueue(state, {});
      }
      throw new Error('Drunk-as-Investigator prompt not found');
    });
  });
});
