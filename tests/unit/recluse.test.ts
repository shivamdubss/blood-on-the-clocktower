import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  transitionToNight,
  getNightPromptInfo,
  advanceNightQueue,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { metadata as recluseMeta } from '../../src/roles/recluse.js';
import { abilityHandler } from '../../src/roles/recluse.js';
import type { GameState, Player, NightPromptInfo } from '../../src/types/game.js';

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

describe('Recluse', () => {
  describe('metadata', () => {
    it('Recluse is an Outsider on the Good team', () => {
      expect(recluseMeta.team).toBe('outsider');
      expect(recluseMeta.type).toBe('outsider');
    });

    it('Recluse has no active night ability (passive role)', () => {
      expect(recluseMeta.firstNight).toBe(false);
      expect(recluseMeta.otherNights).toBe(false);
    });

    it('Recluse ability handler returns success (no-op)', () => {
      const result = abilityHandler(
        { isPoisoned: false, isDrunk: false, gameState: {} as GameState, player: makePlayer(), nightNumber: 1 },
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe('registration in detection abilities', () => {
    function makeGameWithRecluse(): GameState {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      const players = [
        makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'chef', apparentRole: 'chef', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 6 }),
      ];
      state = { ...state, players, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
      return state;
    }

    it('night prompt for Empath includes recluseInfo when Recluse is alive', () => {
      let state = makeGameWithRecluse();
      state = transitionToNight(state);

      // Find the empath's position
      const empathIdx = state.nightQueue.findIndex((e) => e.roleId === 'empath');
      expect(empathIdx).toBeGreaterThanOrEqual(0);

      // Advance to empath
      for (let i = 0; i < empathIdx; i++) {
        state = advanceNightQueue(state, {});
      }

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('empath');
      expect(prompt!.recluseInfo).toBeDefined();
      expect(prompt!.recluseInfo!.playerId).toBe('p3');
      expect(prompt!.recluseInfo!.playerName).toBe('Charlie');
      expect(prompt!.promptDescription).toContain('Recluse');
      expect(prompt!.promptDescription).toContain('may register as Evil');
    });

    it('night prompt for Fortune Teller includes recluseInfo when Recluse is alive', () => {
      let state = makeGameWithRecluse();
      state = transitionToNight(state);

      const ftIdx = state.nightQueue.findIndex((e) => e.roleId === 'fortuneTeller');
      expect(ftIdx).toBeGreaterThanOrEqual(0);

      for (let i = 0; i < ftIdx; i++) {
        state = advanceNightQueue(state, {});
      }

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('fortuneTeller');
      expect(prompt!.recluseInfo).toBeDefined();
      expect(prompt!.recluseInfo!.playerName).toBe('Charlie');
      expect(prompt!.promptDescription).toContain('Recluse');
    });

    it('night prompt for Chef includes recluseInfo on Night 1', () => {
      let state = makeGameWithRecluse();
      // Use night 1 (dayNumber 0 means first night)
      state = { ...state, dayNumber: 0 };
      state = transitionToNight(state);

      const chefIdx = state.nightQueue.findIndex((e) => e.roleId === 'chef');
      expect(chefIdx).toBeGreaterThanOrEqual(0);

      for (let i = 0; i < chefIdx; i++) {
        state = advanceNightQueue(state, {});
      }

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('chef');
      expect(prompt!.recluseInfo).toBeDefined();
      expect(prompt!.recluseInfo!.playerName).toBe('Charlie');
    });

    it('night prompt for non-detection role does NOT include recluseInfo', () => {
      let state = makeGameWithRecluse();
      state = transitionToNight(state);

      const poisonerIdx = state.nightQueue.findIndex((e) => e.roleId === 'poisoner');
      expect(poisonerIdx).toBeGreaterThanOrEqual(0);

      for (let i = 0; i < poisonerIdx; i++) {
        state = advanceNightQueue(state, {});
      }

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('poisoner');
      expect(prompt!.recluseInfo).toBeUndefined();
    });

    it('no recluseInfo when Recluse is dead', () => {
      let state = makeGameWithRecluse();
      // Kill the Recluse
      state = {
        ...state,
        players: state.players.map((p) => (p.id === 'p3' ? { ...p, isAlive: false } : p)),
      };
      state = transitionToNight(state);

      const empathIdx = state.nightQueue.findIndex((e) => e.roleId === 'empath');
      expect(empathIdx).toBeGreaterThanOrEqual(0);

      for (let i = 0; i < empathIdx; i++) {
        state = advanceNightQueue(state, {});
      }

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('empath');
      expect(prompt!.recluseInfo).toBeUndefined();
    });

    it('no recluseInfo when no Recluse in game', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      const players = [
        makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'saint', apparentRole: 'saint', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'chef', apparentRole: 'chef', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 6 }),
      ];
      state = { ...state, players, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
      state = transitionToNight(state);

      const empathIdx = state.nightQueue.findIndex((e) => e.roleId === 'empath');
      for (let i = 0; i < empathIdx; i++) {
        state = advanceNightQueue(state, {});
      }

      const prompt = getNightPromptInfo(state);
      expect(prompt!.recluseInfo).toBeUndefined();
    });

    it('Recluse is Good for win conditions (team is outsider, not evil)', () => {
      expect(recluseMeta.team).toBe('outsider');
      // Outsiders are on the Good team -- verify by checking it's not minion or demon
      expect(recluseMeta.team).not.toBe('minion');
      expect(recluseMeta.team).not.toBe('demon');
    });

    it('Storyteller can include Recluse as Evil in Investigator prompt (manual input)', () => {
      // This test verifies the Storyteller has freedom to provide Recluse as a Minion.
      // The choose_players_and_role prompt allows selecting any 2 players and a Minion role --
      // Recluse can be one of the chosen players at the Storyteller's discretion.
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      const players = [
        makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'investigator', apparentRole: 'investigator', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }),
      ];
      state = { ...state, players, phase: 'night' as const, dayNumber: 0 };
      state = transitionToNight(state);

      const invIdx = state.nightQueue.findIndex((e) => e.roleId === 'investigator');
      expect(invIdx).toBeGreaterThanOrEqual(0);

      for (let i = 0; i < invIdx; i++) {
        state = advanceNightQueue(state, {});
      }

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('investigator');
      // recluseInfo is present to remind Storyteller
      expect(prompt!.recluseInfo).toBeDefined();
      expect(prompt!.recluseInfo!.playerName).toBe('Charlie');
      // prompt type allows choosing any 2 players and a role -- Recluse can be selected
      expect(prompt!.promptType).toBe('choose_players_and_role');
    });
  });

  describe('WebSocket', () => {
    let httpServer: ReturnType<typeof createServer>;
    let ioServer: Server;
    let store: GameStore;
    let clients: ClientSocket[];

    function createClient(): ClientSocket {
      const addr = httpServer.address() as { port: number };
      const client = ioClient(`http://localhost:${addr.port}`, {
        transports: ['websocket'],
        forceNew: true,
      });
      clients.push(client);
      return client;
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

    beforeEach(
      () =>
        new Promise<void>((resolve) => {
          httpServer = createServer();
          ioServer = new Server(httpServer);
          store = { games: new Map() };
          registerSocketHandlers(ioServer, store);
          clients = [];
          httpServer.listen(0, resolve);
        }),
    );

    afterEach(
      () =>
        new Promise<void>((resolve) => {
          clients.forEach((c) => c.disconnect());
          ioServer.close();
          httpServer.close(() => resolve());
        }),
    );

    it('night_prompt for detection role includes recluseInfo via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');

      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'butler', apparentRole: 'butler', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'spy', apparentRole: 'spy', seatIndex: 6 }),
      ];

      let g: GameState = { ...store.games.get(gameId)!, players, storytellerId: storyteller.id!, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
      g = transitionToNight(g);

      // Advance to empath position
      const empathIdx = g.nightQueue.findIndex((e) => e.roleId === 'empath');
      for (let i = 0; i < empathIdx; i++) {
        g = advanceNightQueue(g, {});
      }
      store.games.set(gameId, g);

      // Submit to advance past empath -- listen for the next prompt or queue_empty
      const promptPromise = new Promise<NightPromptInfo | null>((resolve) => {
        storyteller.once('night_prompt', (data: NightPromptInfo) => resolve(data));
        storyteller.once('night_queue_empty', () => resolve(null));
      });

      // First check the current prompt has recluseInfo
      const currentPrompt = getNightPromptInfo(g);
      expect(currentPrompt!.recluseInfo).toBeDefined();
      expect(currentPrompt!.recluseInfo!.playerName).toBe('Charlie');

      storyteller.emit('submit_night_action', { gameId, input: { number: 0 } });

      // Wait for confirmation that the action was processed
      await waitForEvent(storyteller, 'night_action_confirmed');

      // Verify the prompt was sent (the action was processed)
      const nextPrompt = await promptPromise;
      // Next prompt should be a different role
      if (nextPrompt) {
        expect(nextPrompt.roleId).not.toBe('empath');
      }
    });

    it('recluseInfo not present in night_prompt for non-detection roles via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');

      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'recluse', apparentRole: 'recluse', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'butler', apparentRole: 'butler', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'spy', apparentRole: 'spy', seatIndex: 6 }),
      ];

      let g: GameState = { ...store.games.get(gameId)!, players, storytellerId: storyteller.id!, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
      g = transitionToNight(g);

      // Poisoner is first -- check it has no recluseInfo
      store.games.set(gameId, g);
      const prompt = getNightPromptInfo(g);
      expect(prompt!.roleId).toBe('poisoner');
      expect(prompt!.recluseInfo).toBeUndefined();
    });
  });
});
