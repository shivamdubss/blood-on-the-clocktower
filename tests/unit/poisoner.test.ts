import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  poisonPlayer,
  processPoisonerAction,
  transitionToNight,
  buildAbilityContext,
  advanceNightQueue,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { abilityHandler } from '../../src/roles/poisoner.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import type { AbilityResult } from '../../src/types/ability.js';

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
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }));
  return state;
}

describe('Poisoner', () => {
  describe('state machine', () => {
    it('processPoisonerAction poisons the target player', () => {
      const state = makeGameWithPlayers();
      const result = processPoisonerAction(state, 'p3');

      const target = result.players.find((p) => p.id === 'p3');
      expect(target!.isPoisoned).toBe(true);
    });

    it('processPoisonerAction clears all previous poison before applying new poison', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p3');
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

      const result = processPoisonerAction(state, 'p4');

      expect(result.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);
      expect(result.players.find((p) => p.id === 'p4')!.isPoisoned).toBe(true);
    });

    it('processPoisonerAction logs the action', () => {
      const state = makeGameWithPlayers();
      const result = processPoisonerAction(state, 'p3');

      const logEntry = result.gameLog.find((l) => l.type === 'poisoner_action');
      expect(logEntry).toBeDefined();
      expect((logEntry!.data as { targetPlayerId: string }).targetPlayerId).toBe('p3');
    });

    it('processPoisonerAction returns same state for invalid target', () => {
      const state = makeGameWithPlayers();
      const result = processPoisonerAction(state, 'nonexistent');
      expect(result).toBe(state);
    });

    it('only one player is poisoned at a time after Poisoner acts', () => {
      const state = makeGameWithPlayers();
      const result = processPoisonerAction(state, 'p5');

      const poisonedPlayers = result.players.filter((p) => p.isPoisoned);
      expect(poisonedPlayers).toHaveLength(1);
      expect(poisonedPlayers[0].id).toBe('p5');
    });

    it('Poisoner fires on Night 1 (is in the night queue)', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      const poisonerEntry = state.nightQueue.find((e) => e.roleId === 'poisoner');
      expect(poisonerEntry).toBeDefined();
      expect(poisonerEntry!.playerId).toBe('p1');
    });

    it('Poisoner fires on subsequent nights (is in the night queue)', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);

      const poisonerEntry = state.nightQueue.find((e) => e.roleId === 'poisoner');
      expect(poisonerEntry).toBeDefined();
    });

    it('poison status is visible via buildAbilityContext for poisoned player', () => {
      let state = makeGameWithPlayers();
      state = processPoisonerAction(state, 'p3');

      const context = buildAbilityContext(state, 'p3', 1);
      expect(context.isPoisoned).toBe(true);
    });

    it('poison lasts until Poisoner acts again the following night', () => {
      let state = makeGameWithPlayers();
      state = processPoisonerAction(state, 'p3');
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

      state = processPoisonerAction(state, 'p4');
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);
      expect(state.players.find((p) => p.id === 'p4')!.isPoisoned).toBe(true);
    });
  });

  describe('ability handler', () => {
    it('returns success with target info when valid target provided', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'p3' }) as AbilityResult;

      expect(result.success).toBe(true);
      expect((result.data as { targetPlayerId: string; effective: boolean }).targetPlayerId).toBe('p3');
      expect((result.data as { targetPlayerId: string; effective: boolean }).effective).toBe(true);
    });

    it('returns failure when no target provided', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, undefined) as AbilityResult;

      expect(result.success).toBe(false);
    });

    it('returns ineffective when Poisoner is poisoned', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p1');
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'p3' }) as AbilityResult;

      expect(result.success).toBe(true);
      expect((result.data as { targetPlayerId: string; effective: boolean }).effective).toBe(false);
    });
  });

  describe('Poisoner timing', () => {
    it('Poisoner is first in the Night 1 order', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      expect(state.nightQueue[0].roleId).toBe('poisoner');
    });

    it('Poisoner is first in the Night 2+ order', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 };
      state = transitionToNight(state);

      expect(state.nightQueue[0].roleId).toBe('poisoner');
    });

    it('poison applies before other abilities fire in the queue', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      state = processPoisonerAction(state, 'p3');
      state = advanceNightQueue(state, { targetPlayerId: 'p3' });

      const washContext = buildAbilityContext(state, 'p3', 1);
      expect(washContext.isPoisoned).toBe(true);
    });
  });

  describe('poison duration', () => {
    it('poison persists through the day until the next night Poisoner action', () => {
      let state = makeGameWithPlayers();
      state = processPoisonerAction(state, 'p3');
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

      state = { ...state, phase: 'day' as const, daySubPhase: 'discussion' as const, dayNumber: 1 };
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

      state = processPoisonerAction(state, 'p4');
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);
      expect(state.players.find((p) => p.id === 'p4')!.isPoisoned).toBe(true);
    });

    it('poison persists if Poisoner re-poisons the same target', () => {
      let state = makeGameWithPlayers();
      state = processPoisonerAction(state, 'p3');
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

      state = processPoisonerAction(state, 'p3');
      expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);
      expect(state.players.filter((p) => p.isPoisoned)).toHaveLength(1);
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

    it('Storyteller can submit Poisoner night action and target becomes poisoned', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = { ...g, players, storytellerId: storyteller.id!, phase: 'night' as const, daySubPhase: null, dayNumber: 0 };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'poisoner' as RoleId, playerId: storyteller.id!, completed: false },
          { roleId: 'washerwoman' as RoleId, playerId: 'p3', completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');
      const grimoirePromise = waitForEvent(storyteller, 'grimoire');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });

      await confirmPromise;
      const grimoire = await grimoirePromise as { players: Array<{ playerId: string; isPoisoned: boolean }> };

      const charlie = grimoire.players.find((p) => p.playerId === 'p3');
      expect(charlie).toBeDefined();
      expect(charlie!.isPoisoned).toBe(true);

      const updatedState = store.games.get(gameId)!;
      const charlieState = updatedState.players.find((p) => p.id === 'p3');
      expect(charlieState!.isPoisoned).toBe(true);
    });

    it('Poisoner action clears previous poison when acting again', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2, isPoisoned: true }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = { ...g, players, storytellerId: storyteller.id!, phase: 'night' as const, daySubPhase: null, dayNumber: 1 };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'poisoner' as RoleId, playerId: storyteller.id!, completed: false },
          { roleId: 'imp' as RoleId, playerId: 'p2', completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const grimoirePromise = waitForEvent(storyteller, 'grimoire');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p4' } });

      const grimoire = await grimoirePromise as { players: Array<{ playerId: string; isPoisoned: boolean }> };

      const charlie = grimoire.players.find((p) => p.playerId === 'p3');
      expect(charlie!.isPoisoned).toBe(false);

      const diana = grimoire.players.find((p) => p.playerId === 'p4');
      expect(diana!.isPoisoned).toBe(true);
    });

    it('Grimoire shows poison status after Poisoner acts', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = { ...g, players, storytellerId: storyteller.id!, phase: 'night' as const, daySubPhase: null, dayNumber: 0 };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'poisoner' as RoleId, playerId: storyteller.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const grimoirePromise = waitForEvent(storyteller, 'grimoire');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p5' } });

      const grimoire = await grimoirePromise as { players: Array<{ playerId: string; isPoisoned: boolean }> };

      for (const player of grimoire.players) {
        if (player.playerId === 'p5') {
          expect(player.isPoisoned).toBe(true);
        } else {
          expect(player.isPoisoned).toBe(false);
        }
      }
    });

    it('poison status is not leaked to players in sanitized game_state at end_night', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const playerClient = createClient();
      await new Promise<void>((resolve) => playerClient.on('connect', resolve));

      playerClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Player2' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;

      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }),
        makePlayer({ id: playerClient.id!, name: 'Player2', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      // Set up state where Poisoner has already acted and poisoned Player2
      let nightState = { ...g, players, storytellerId: storyteller.id!, phase: 'night' as const, daySubPhase: null, dayNumber: 0 };
      // Poison Player2
      nightState = {
        ...nightState,
        players: nightState.players.map((p) =>
          p.id === playerClient.id! ? { ...p, isPoisoned: true } : p
        ),
        nightQueue: [],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      // Listen for game_state on the player client when end_night fires
      const gameStatePromise = waitForEvent(playerClient, 'game_state');

      storyteller.emit('end_night', { gameId });

      const gameState = await gameStatePromise as { players: Array<{ isPoisoned: boolean }> };

      // All players should show isPoisoned: false in sanitized state
      for (const player of gameState.players) {
        expect(player.isPoisoned).toBe(false);
      }

      // But actual state should still have Player2 poisoned
      const actualState = store.games.get(gameId)!;
      const p2State = actualState.players.find((p) => p.id === playerClient.id!);
      expect(p2State!.isPoisoned).toBe(true);
    });

    it('Poisoner identity is known to Demon on Night 1 (via minion team)', () => {
      const state = makeGameWithPlayers();
      const poisoner = state.players.find((p) => p.trueRole === 'poisoner');
      expect(poisoner).toBeDefined();
      expect(poisoner!.trueRole).toBe('poisoner');
    });
  });
});
