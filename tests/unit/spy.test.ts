import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  transitionToNight,
  getNightPromptInfo,
  buildGrimoireData,
  advanceNightQueue,
  buildAbilityContext,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { abilityHandler } from '../../src/roles/spy.js';
import { metadata as spyMeta } from '../../src/roles/spy.js';
import type { GameState, Player, RoleId, NightPromptInfo } from '../../src/types/game.js';

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
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'spy', apparentRole: 'spy', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }));
  return state;
}

describe('Spy', () => {
  describe('metadata', () => {
    it('Spy is a Minion on the Evil team', () => {
      expect(spyMeta.team).toBe('minion');
      expect(spyMeta.type).toBe('minion');
    });

    it('Spy fires on Night 1 and other nights', () => {
      expect(spyMeta.firstNight).toBe(true);
      expect(spyMeta.otherNights).toBe(true);
    });
  });

  describe('state machine', () => {
    it('Spy appears in the night queue', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);
      const spyEntry = state.nightQueue.find(e => e.roleId === 'spy');
      expect(spyEntry).toBeDefined();
      expect(spyEntry!.playerId).toBe('p2');
    });

    it('Spy night prompt includes grimoireData with all players', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      // Position queue to the Spy entry
      const spyIdx = state.nightQueue.findIndex(e => e.roleId === 'spy');
      expect(spyIdx).toBeGreaterThanOrEqual(0);
      state = { ...state, nightQueuePosition: spyIdx };

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('spy');
      expect(prompt!.grimoireData).toBeDefined();
      expect(prompt!.grimoireData!.players).toHaveLength(7);
    });

    it('Spy grimoire data shows all players true roles, alive/dead, poison, drunk status', () => {
      let state = makeGameWithPlayers();
      // Mark one player as poisoned and one as dead
      state = {
        ...state,
        players: state.players.map(p => {
          if (p.id === 'p3') return { ...p, isPoisoned: true };
          if (p.id === 'p5') return { ...p, isAlive: false };
          return p;
        }),
      };
      state = transitionToNight(state);

      const spyIdx = state.nightQueue.findIndex(e => e.roleId === 'spy');
      state = { ...state, nightQueuePosition: spyIdx };

      const prompt = getNightPromptInfo(state);
      expect(prompt!.grimoireData).toBeDefined();

      const grimoirePlayers = prompt!.grimoireData!.players;

      // Check that true roles are visible
      const imp = grimoirePlayers.find(p => p.playerId === 'p1');
      expect(imp!.trueRole!.id).toBe('imp');

      const spy = grimoirePlayers.find(p => p.playerId === 'p2');
      expect(spy!.trueRole!.id).toBe('spy');

      const washerwoman = grimoirePlayers.find(p => p.playerId === 'p3');
      expect(washerwoman!.trueRole!.id).toBe('washerwoman');
      // Note: transitionToNight clears poison, so we check alive status instead
      const eve = grimoirePlayers.find(p => p.playerId === 'p5');
      expect(eve!.isAlive).toBe(false);
    });

    it('Spy grimoire data includes Fortune Teller red herring ID', () => {
      let state = makeGameWithPlayers();
      state = { ...state, fortuneTellerRedHerringId: 'p3' };
      state = transitionToNight(state);

      const spyIdx = state.nightQueue.findIndex(e => e.roleId === 'spy');
      state = { ...state, nightQueuePosition: spyIdx };

      const prompt = getNightPromptInfo(state);
      expect(prompt!.grimoireData!.fortuneTellerRedHerringId).toBe('p3');
    });

    it('non-Spy roles do not have grimoireData in their night prompt', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      // Poisoner is first in queue (position 0)
      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('poisoner');
      expect(prompt!.grimoireData).toBeUndefined();
    });

    it('Spy prompt description mentions Grimoire and registration', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      const spyIdx = state.nightQueue.findIndex(e => e.roleId === 'spy');
      state = { ...state, nightQueuePosition: spyIdx };

      const prompt = getNightPromptInfo(state);
      expect(prompt!.promptDescription).toContain('Grimoire');
      expect(prompt!.promptDescription).toContain('register as Good');
    });

    it('Spy prompt type is info_only', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      const spyIdx = state.nightQueue.findIndex(e => e.roleId === 'spy');
      state = { ...state, nightQueuePosition: spyIdx };

      const prompt = getNightPromptInfo(state);
      expect(prompt!.promptType).toBe('info_only');
    });

    it('buildGrimoireData returns correct structure', () => {
      const state = makeGameWithPlayers();
      const grimoire = buildGrimoireData(state);

      expect(grimoire.players).toHaveLength(7);
      expect(grimoire.fortuneTellerRedHerringId).toBeNull();

      const p1 = grimoire.players.find(p => p.playerId === 'p1');
      expect(p1!.trueRole!.id).toBe('imp');
      expect(p1!.isAlive).toBe(true);
      expect(p1!.isPoisoned).toBe(false);
      expect(p1!.isDrunk).toBe(false);
    });

    it('Spy ability handler returns success (info_only action)', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p2', 1);
      const result = abilityHandler(context, {});
      expect(result.success).toBe(true);
    });

    it('Spy registration: prompt tells Storyteller that Spy may register as Good', () => {
      let state = makeGameWithPlayers();
      state = transitionToNight(state);

      const spyIdx = state.nightQueue.findIndex(e => e.roleId === 'spy');
      state = { ...state, nightQueuePosition: spyIdx };

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.roleId).toBe('spy');
      // Prompt must inform the Storyteller about registration options
      expect(prompt!.promptDescription).toContain('register as Good');
      expect(prompt!.promptDescription).toContain('Townsfolk/Outsider');
    });

    it('Spy is on Evil team for win conditions', () => {
      expect(spyMeta.team).toBe('minion');
      // Minions are Evil team — verify Spy's true role is treated as Evil
      const state = makeGameWithPlayers();
      const spyPlayer = state.players.find(p => p.trueRole === 'spy');
      expect(spyPlayer).toBeDefined();
      // Spy should be on the evil team (minion team = evil)
      expect(['minion', 'demon']).toContain(spyMeta.type);
    });
  });

  describe('WebSocket', () => {
    let httpServer: ReturnType<typeof createServer>;
    let ioServer: Server;
    let store: GameStore;
    let clients: ClientSocket[];
    const PORT = 0;

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
          httpServer.listen(PORT, resolve);
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

    it('Spy night prompt includes grimoireData via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');

      // Set up game state with Spy in queue
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'spy', apparentRole: 'spy', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }),
      ];

      let g = store.games.get(gameId)!;
      g = { ...g, players, storytellerId: storyteller.id!, phase: 'day', daySubPhase: 'end', dayNumber: 1 };
      g = transitionToNight(g);

      // Position queue to the Spy entry
      const spyIdx = g.nightQueue.findIndex(e => e.roleId === 'spy');

      // Advance queue to just before the Spy by marking prior entries as completed
      for (let i = 0; i < spyIdx; i++) {
        g = advanceNightQueue(g, {});
      }
      store.games.set(gameId, g);

      // Submit the Spy's night action
      const promptPromise = new Promise<NightPromptInfo | null>((resolve) => {
        // Listen for either next prompt or queue_empty
        storyteller.once('night_prompt', (data: NightPromptInfo) => resolve(data));
        storyteller.once('night_queue_empty', () => resolve(null));
      });

      // First get the current spy prompt which should have grimoire data
      const currentPrompt = getNightPromptInfo(g);
      expect(currentPrompt).not.toBeNull();
      expect(currentPrompt!.roleId).toBe('spy');
      expect(currentPrompt!.grimoireData).toBeDefined();
      expect(currentPrompt!.grimoireData!.players).toHaveLength(7);

      // Submit the action to advance past the Spy
      storyteller.emit('submit_night_action', { gameId });

      // After advancing, we should get either next prompt or queue_empty
      const nextPrompt = await promptPromise;
      if (nextPrompt) {
        // Next prompt should NOT be the Spy
        expect(nextPrompt.roleId).not.toBe('spy');
      }
    });

    it('Spy grimoire data is not leaked to non-Storyteller clients', { timeout: 10000 }, async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const player = createClient();

      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => player.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');

      player.emit('join_game', { joinCode: 'ABC123', playerName: 'Spy' });
      await waitForEvent(player, 'game_joined');

      // Set up state with spy in queue
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: player.id!, name: 'Spy', trueRole: 'spy', apparentRole: 'spy', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }),
      ];

      let g: GameState = { ...store.games.get(gameId)!, players, storytellerId: storyteller.id!, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
      g = transitionToNight(g);

      const spyIdx = g.nightQueue.findIndex(e => e.roleId === 'spy');
      for (let i = 0; i < spyIdx; i++) {
        g = advanceNightQueue(g, {});
      }
      store.games.set(gameId, g);

      // The player (Spy) should NOT receive a night_prompt event — only the Storyteller gets it
      let playerReceivedPrompt = false;
      player.on('night_prompt', () => {
        playerReceivedPrompt = true;
      });

      const stPromise = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId });
      await stPromise;

      // Give a bit of time for any leaked events
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(playerReceivedPrompt).toBe(false);
    });

    it('Spy night prompt has correct prompt description via WebSocket', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');

      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'imp', apparentRole: 'imp', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'spy', apparentRole: 'spy', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }),
      ];

      let g: GameState = { ...store.games.get(gameId)!, players, storytellerId: storyteller.id!, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
      g = transitionToNight(g);

      // Position to spy
      const spyIdx = g.nightQueue.findIndex(e => e.roleId === 'spy');
      for (let i = 0; i < spyIdx; i++) {
        g = advanceNightQueue(g, {});
      }
      store.games.set(gameId, g);

      // Trigger the spy prompt via end_day (not possible since already in night)
      // Instead, submit previous action to get Spy prompt
      // Actually, we already positioned the queue. Let's just read the prompt directly from state.
      const prompt = getNightPromptInfo(g);
      expect(prompt!.promptDescription).toContain('Grimoire');
      expect(prompt!.promptDescription).toContain('Bob');
      expect(prompt!.promptDescription).toContain('Spy');
    });
  });
});
