import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  addPendingDeath,
  buildAbilityContext,
  getNightPromptInfo,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { abilityHandler } from '../../src/roles/ravenkeeper.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import { NIGHT_1_ORDER, NIGHT_OTHER_ORDER } from '../../src/data/nightOrder.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'ravenkeeper',
    apparentRole: 'ravenkeeper',
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
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'ravenkeeper', apparentRole: 'ravenkeeper', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }));
  return state;
}

describe('Ravenkeeper', () => {
  describe('night order', () => {
    it('Ravenkeeper is NOT in Night 1 order', () => {
      expect(NIGHT_1_ORDER).not.toContain('ravenkeeper');
    });

    it('Ravenkeeper is in other nights order', () => {
      expect(NIGHT_OTHER_ORDER).toContain('ravenkeeper');
    });

    it('Ravenkeeper acts after the Imp in night order', () => {
      const rkIndex = NIGHT_OTHER_ORDER.indexOf('ravenkeeper');
      const impIndex = NIGHT_OTHER_ORDER.indexOf('imp');
      expect(rkIndex).toBeGreaterThan(impIndex);
    });
  });

  describe('night prompt', () => {
    it('prompt indicates Ravenkeeper was killed when in pendingDeaths', () => {
      let state = makeGameWithPlayers();
      state = addPendingDeath(state, 'p1');
      state = {
        ...state,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
        nightQueue: [
          { roleId: 'ravenkeeper' as RoleId, playerId: 'p1', completed: false },
        ],
        nightQueuePosition: 0,
      };

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.ravenkeeperKilledTonight).toBe(true);
      expect(prompt!.promptType).toBe('choose_player_and_provide_role');
      expect(prompt!.promptDescription).toContain('killed by the Demon');
    });

    it('prompt indicates Ravenkeeper was NOT killed when not in pendingDeaths', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
        nightQueue: [
          { roleId: 'ravenkeeper' as RoleId, playerId: 'p1', completed: false },
        ],
        nightQueuePosition: 0,
      };

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.ravenkeeperKilledTonight).toBe(false);
      expect(prompt!.promptType).toBe('info_only');
      expect(prompt!.promptDescription).toContain('NOT killed');
    });
  });

  describe('ability handler', () => {
    it('returns success with triggered info when killed', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3', role: 'washerwoman' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        triggered: true,
        targetPlayerId: 'p3',
        revealedRole: 'washerwoman',
        isCorrupted: false,
      });
    });

    it('returns success with notTriggered when not killed', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { notTriggered: true });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ triggered: false });
    });

    it('fails if no target selected', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('No target');
    });

    it('fails if no role provided', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('No role');
    });

    it('fails if target player not found', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'nonexistent', role: 'washerwoman' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('when poisoned, marks as corrupted', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p1' ? { ...p, isPoisoned: true } : p)),
      };
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3', role: 'chef' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        triggered: true,
        targetPlayerId: 'p3',
        revealedRole: 'chef',
        isCorrupted: true,
      });
    });

    it('when drunk, marks as corrupted', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p1' ? { ...p, isDrunk: true } : p)),
      };
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { targetPlayerId: 'p3', role: 'chef' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        triggered: true,
        isCorrupted: true,
      });
    });

    it('does not trigger on execution (only Demon kill)', () => {
      // Ravenkeeper ability only triggers from Demon kill at night
      // If not killed (notTriggered), the ability returns triggered: false
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 2);
      const result = abilityHandler(context, { notTriggered: true });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ triggered: false });
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

    function waitForEvent(socket: ClientSocket, event: string, timeout = 5000): Promise<unknown> {
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

    it('Ravenkeeper receives night_info with role when killed by Demon', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const ravenkeeperClient = createClient();

      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => ravenkeeperClient.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      ravenkeeperClient.emit('join_game', { joinCode: 'ABC123', playerName: 'RK' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 0 }),
        makePlayer({ id: ravenkeeperClient.id!, name: 'RK', trueRole: 'ravenkeeper', apparentRole: 'ravenkeeper', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'imp', apparentRole: 'imp', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }),
      ];

      // Set up night state with Ravenkeeper killed (in pendingDeaths)
      const nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
        pendingDeaths: [ravenkeeperClient.id!],
        nightQueue: [
          { roleId: 'ravenkeeper' as RoleId, playerId: ravenkeeperClient.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      // Listen for night_info on the RK client
      const nightInfoPromise = waitForEvent(ravenkeeperClient, 'night_info');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      storyteller.emit('submit_night_action', {
        gameId,
        input: { targetPlayerId: 'p4', role: 'empath' },
      });

      const [nightInfo] = await Promise.all([nightInfoPromise, confirmPromise]);
      const info = nightInfo as Record<string, unknown>;
      expect(info.roleId).toBe('ravenkeeper');
      expect(info.targetPlayerId).toBe('p4');
      expect(info.targetPlayerName).toBe('Diana');
      expect(info.role).toBe('empath');
    });

    it('Ravenkeeper does NOT receive night_info when not killed', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const ravenkeeperClient = createClient();

      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => ravenkeeperClient.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      ravenkeeperClient.emit('join_game', { joinCode: 'ABC123', playerName: 'RK' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 0 }),
        makePlayer({ id: ravenkeeperClient.id!, name: 'RK', trueRole: 'ravenkeeper', apparentRole: 'ravenkeeper', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'imp', apparentRole: 'imp', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }),
      ];

      // Set up night state WITHOUT Ravenkeeper in pendingDeaths
      const nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
        pendingDeaths: [],
        nightQueue: [
          { roleId: 'ravenkeeper' as RoleId, playerId: ravenkeeperClient.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      // Track if night_info is received (it should NOT be)
      let nightInfoReceived = false;
      ravenkeeperClient.on('night_info', () => {
        nightInfoReceived = true;
      });

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', {
        gameId,
        input: { notTriggered: true },
      });
      await confirmPromise;

      // Wait a bit to confirm no night_info was sent
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      expect(nightInfoReceived).toBe(false);
    });

    it('Ravenkeeper receives night_info with isPoisoned flag when poisoned', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const ravenkeeperClient = createClient();

      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => ravenkeeperClient.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      ravenkeeperClient.emit('join_game', { joinCode: 'ABC123', playerName: 'RK' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 0 }),
        makePlayer({ id: ravenkeeperClient.id!, name: 'RK', trueRole: 'ravenkeeper', apparentRole: 'ravenkeeper', seatIndex: 1, isPoisoned: true }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'imp', apparentRole: 'imp', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }),
      ];

      const nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
        pendingDeaths: [ravenkeeperClient.id!],
        nightQueue: [
          { roleId: 'ravenkeeper' as RoleId, playerId: ravenkeeperClient.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const nightInfoPromise = waitForEvent(ravenkeeperClient, 'night_info');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');

      // Storyteller provides false role info since RK is poisoned
      storyteller.emit('submit_night_action', {
        gameId,
        input: { targetPlayerId: 'p4', role: 'chef' },
      });

      const [nightInfo] = await Promise.all([nightInfoPromise, confirmPromise]);
      const info = nightInfo as Record<string, unknown>;
      expect(info.roleId).toBe('ravenkeeper');
      expect(info.role).toBe('chef'); // false role due to poisoning
    });

    it('Imp kill followed by Ravenkeeper trigger in night queue', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const ravenkeeperClient = createClient();

      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => ravenkeeperClient.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      ravenkeeperClient.emit('join_game', { joinCode: 'ABC123', playerName: 'RK' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 0 }),
        makePlayer({ id: ravenkeeperClient.id!, name: 'RK', trueRole: 'ravenkeeper', apparentRole: 'ravenkeeper', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'imp', apparentRole: 'imp', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }),
      ];

      const nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 2,
        pendingDeaths: [],
        nightQueue: [
          { roleId: 'imp' as RoleId, playerId: 'p3', completed: false },
          { roleId: 'ravenkeeper' as RoleId, playerId: ravenkeeperClient.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      // Step 1: Imp kills the Ravenkeeper
      const impConfirm = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', {
        gameId,
        input: { targetPlayerId: ravenkeeperClient.id! },
      });
      await impConfirm;

      // Verify RK is now in pendingDeaths
      const afterImp = store.games.get(gameId)!;
      expect(afterImp.pendingDeaths).toContain(ravenkeeperClient.id!);

      // Step 2: Ravenkeeper's turn - now killed, should trigger ability
      // Check the night prompt includes ravenkeeperKilledTonight
      const nextPrompt = getNightPromptInfo(afterImp);
      expect(nextPrompt).not.toBeNull();
      expect(nextPrompt!.roleId).toBe('ravenkeeper');
      expect(nextPrompt!.ravenkeeperKilledTonight).toBe(true);

      // Submit Ravenkeeper's choice
      const nightInfoPromise = waitForEvent(ravenkeeperClient, 'night_info');
      const rkConfirm = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', {
        gameId,
        input: { targetPlayerId: 'p4', role: 'empath' },
      });

      const [nightInfo] = await Promise.all([nightInfoPromise, rkConfirm]);
      const info = nightInfo as Record<string, unknown>;
      expect(info.roleId).toBe('ravenkeeper');
      expect(info.targetPlayerId).toBe('p4');
      expect(info.role).toBe('empath');
    });
  });
});
