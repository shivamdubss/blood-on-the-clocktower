import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  processImpAction,
  addPendingDeath,
  transitionToNight,
  buildAbilityContext,
  poisonPlayer,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { abilityHandler } from '../../src/roles/imp.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';

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
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'soldier', apparentRole: 'soldier', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'mayor', apparentRole: 'mayor', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'spy', apparentRole: 'spy', seatIndex: 6 }));
  return state;
}

describe('Imp', () => {
  describe('state machine', () => {
    it('processImpAction adds target to pendingDeaths', () => {
      const state = makeGameWithPlayers();
      const result = processImpAction(state, 'p3', 'p1');
      expect(result.pendingDeaths).toContain('p3');
    });

    it('processImpAction logs imp_kill event', () => {
      const state = makeGameWithPlayers();
      const result = processImpAction(state, 'p3', 'p1');
      const killLog = result.gameLog.find((l) => l.type === 'imp_kill');
      expect(killLog).toBeDefined();
      expect((killLog!.data as { targetPlayerId: string }).targetPlayerId).toBe('p3');
    });

    it('Imp kill is blocked by Monk protection', () => {
      let state = makeGameWithPlayers();
      state = { ...state, monkProtectedPlayerId: 'p3' };
      const result = processImpAction(state, 'p3', 'p1');

      expect(result.pendingDeaths).not.toContain('p3');
      const blockedLog = result.gameLog.find((l) => l.type === 'imp_kill_blocked');
      expect(blockedLog).toBeDefined();
      expect((blockedLog!.data as { reason: string }).reason).toBe('monk_protection');
    });

    it('Imp kill is blocked by Soldier protection (not poisoned)', () => {
      const state = makeGameWithPlayers();
      const result = processImpAction(state, 'p4', 'p1'); // p4 is Soldier

      expect(result.pendingDeaths).not.toContain('p4');
      const blockedLog = result.gameLog.find((l) => l.type === 'imp_kill_blocked');
      expect(blockedLog).toBeDefined();
      expect((blockedLog!.data as { reason: string }).reason).toBe('soldier_protection');
    });

    it('Imp kill succeeds against poisoned Soldier', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p4'); // Poison the Soldier
      const result = processImpAction(state, 'p4', 'p1');

      expect(result.pendingDeaths).toContain('p4');
    });

    it('star-pass: Imp self-targets, dies, Minion becomes new Imp', () => {
      const state = makeGameWithPlayers();
      const result = processImpAction(state, 'p1', 'p1', 'p2'); // p2 is Poisoner (Minion)

      expect(result.pendingDeaths).toContain('p1');
      const newImp = result.players.find((p) => p.id === 'p2');
      expect(newImp!.trueRole).toBe('imp');

      const starPassLog = result.gameLog.find((l) => l.type === 'imp_star_pass');
      expect(starPassLog).toBeDefined();
      expect((starPassLog!.data as { newImpId: string }).newImpId).toBe('p2');
    });

    it('star-pass picks first available Minion if no starPassMinionId given', () => {
      const state = makeGameWithPlayers();
      const result = processImpAction(state, 'p1', 'p1');

      expect(result.pendingDeaths).toContain('p1');
      // Should find one of the minions (p2=poisoner or p7=spy)
      const newImps = result.players.filter((p) => p.trueRole === 'imp' && p.id !== 'p1');
      expect(newImps.length).toBe(1);
    });

    it('star-pass does NOT trigger Scarlet Woman (separate from Demon death)', () => {
      let state = makeGameWithPlayers();
      // Replace spy with scarletWoman for this test
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p7' ? { ...p, trueRole: 'scarletWoman' as RoleId, apparentRole: 'scarletWoman' as RoleId } : p
        ),
      };

      // Star pass to Poisoner (p2), Scarlet Woman should NOT become Imp independently
      const result = processImpAction(state, 'p1', 'p1', 'p2');

      // p2 becomes Imp via star-pass
      expect(result.players.find((p) => p.id === 'p2')!.trueRole).toBe('imp');
      // p7 (Scarlet Woman) stays as scarletWoman - the star-pass log type is 'imp_star_pass', not a demon death
      expect(result.players.find((p) => p.id === 'p7')!.trueRole).toBe('scarletWoman');
    });

    it('star-pass updates role in Grimoire (players array)', () => {
      const state = makeGameWithPlayers();
      const result = processImpAction(state, 'p1', 'p1', 'p7'); // p7=spy becomes Imp

      const newImp = result.players.find((p) => p.id === 'p7');
      expect(newImp!.trueRole).toBe('imp');
    });

    it('does not add dead target to pendingDeaths', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p3' ? { ...p, isAlive: false } : p
        ),
      };
      const result = processImpAction(state, 'p3', 'p1');
      expect(result.pendingDeaths).not.toContain('p3');
    });

    it('Imp appears in NIGHT_OTHER_ORDER queue but not NIGHT_1_ORDER', () => {
      let state = makeGameWithPlayers();
      state = { ...state, phase: 'day' as const, dayNumber: 0 };
      const night1State = transitionToNight(state); // dayNumber=0 → night 1
      const impInNight1 = night1State.nightQueue.find((e) => e.roleId === 'imp');
      expect(impInNight1).toBeUndefined();

      state = { ...state, phase: 'day' as const, dayNumber: 1 };
      const night2State = transitionToNight(state); // dayNumber=1 → night 2
      const impInNight2 = night2State.nightQueue.find((e) => e.roleId === 'imp');
      expect(impInNight2).toBeDefined();
      expect(impInNight2!.playerId).toBe('p1');
    });
  });

  describe('ability handler', () => {
    it('returns success with kill data for valid target', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });
      expect(result.success).toBe(true);
      expect((result.data as { effective: boolean; isStarPass: boolean }).effective).toBe(true);
      expect((result.data as { isStarPass: boolean }).isStarPass).toBe(false);
    });

    it('returns failure when no target selected', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, {});
      expect(result.success).toBe(false);
    });

    it('returns failure for invalid target', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'nonexistent' });
      expect(result.success).toBe(false);
    });

    it('returns failure for dead target', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p3' ? { ...p, isAlive: false } : p
        ),
      };
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });
      expect(result.success).toBe(false);
    });

    it('returns ineffective when Imp is poisoned', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p1');
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });
      expect(result.success).toBe(true);
      expect((result.data as { effective: boolean }).effective).toBe(false);
      expect((result.data as { reason: string }).reason).toBe('poisoned');
    });

    it('returns star-pass data when Imp targets self', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p1', starPassMinionId: 'p2' });
      expect(result.success).toBe(true);
      expect((result.data as { isStarPass: boolean }).isStarPass).toBe(true);
      expect((result.data as { starPassMinionId: string }).starPassMinionId).toBe('p2');
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

    it('Storyteller can submit Imp night action and target is added to pendingDeaths', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = { ...g, players, storytellerId: storyteller.id!, phase: 'night' as const, daySubPhase: null, dayNumber: 1 };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'imp' as RoleId, playerId: storyteller.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });

      await confirmPromise;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.pendingDeaths).toContain('p3');
    });

    it('Imp kill is blocked by Monk protection via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'monk', apparentRole: 'monk', seatIndex: 1 }),
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
        dayNumber: 1,
        monkProtectedPlayerId: 'p3',
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'imp' as RoleId, playerId: storyteller.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });

      await confirmPromise;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.pendingDeaths).not.toContain('p3');
    });

    it('Imp poisoned: kill has no effect via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0, isPoisoned: true }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = { ...g, players, storytellerId: storyteller.id!, phase: 'night' as const, daySubPhase: null, dayNumber: 1 };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'imp' as RoleId, playerId: storyteller.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });

      await confirmPromise;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.pendingDeaths).not.toContain('p3');
    });

    it('Imp star-pass via WebSocket: Imp dies, Minion becomes Imp', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const impId = storyteller.id!;
      const players = [
        makePlayer({ id: impId, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = { ...g, players, storytellerId: impId, phase: 'night' as const, daySubPhase: null, dayNumber: 1 };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'imp' as RoleId, playerId: impId, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');
      const grimoirePromise = waitForEvent(storyteller, 'grimoire');

      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: impId, starPassMinionId: 'p2' } });

      await confirmPromise;
      const grimoire = await grimoirePromise as { players: Array<{ playerId: string; trueRole: { id: string } }> };

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.pendingDeaths).toContain(impId);

      const newImp = updatedState.players.find((p) => p.id === 'p2');
      expect(newImp!.trueRole).toBe('imp');

      // Grimoire should reflect the new role
      const bobInGrimoire = grimoire.players.find((p) => p.playerId === 'p2');
      expect(bobInGrimoire!.trueRole.id).toBe('imp');
    });

    it('Imp kill target shows up in dawn announcement after end_night', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }),
      ];

      let nightState = { ...g, players, storytellerId: storyteller.id!, phase: 'night' as const, daySubPhase: null, dayNumber: 1 };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'imp' as RoleId, playerId: storyteller.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      // Submit Imp action
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });
      await confirmPromise;

      // Now end the night
      const dawnPromise = waitForEvent(storyteller, 'dawn_announcement');
      storyteller.emit('end_night', { gameId });
      const dawn = await dawnPromise as { deaths: Array<{ playerId: string; playerName: string }> };

      expect(dawn.deaths).toHaveLength(1);
      expect(dawn.deaths[0].playerId).toBe('p3');
      expect(dawn.deaths[0].playerName).toBe('Charlie');

      // Charlie should be dead
      const updatedState = store.games.get(gameId)!;
      const charlie = updatedState.players.find((p) => p.id === 'p3');
      expect(charlie!.isAlive).toBe(false);
    });
  });
});
