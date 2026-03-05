import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  buildAbilityContext,
  transitionToNight,
  generateNightQueue,
  getNightPromptInfo,
  advanceNightQueue,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
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

function makeGameWithDrunk() {
  let state = createInitialGameState('g1', 'ABC123', 'st1');
  // Drunk thinks they are the Chef (apparent role)
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'drunk', apparentRole: 'chef', isDrunk: true, seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'empath', apparentRole: 'empath', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'imp', apparentRole: 'imp', seatIndex: 4 }));
  return state;
}

describe('Drunk ability', () => {
  describe('Drunk client shows their apparent Townsfolk role', () => {
    it('Drunk player apparentRole is a Townsfolk, not Drunk', () => {
      const state = makeGameWithDrunk();
      const drunkPlayer = state.players.find((p) => p.id === 'p1')!;

      expect(drunkPlayer.trueRole).toBe('drunk');
      expect(drunkPlayer.apparentRole).toBe('chef');
      expect(drunkPlayer.apparentRole).not.toBe('drunk');
    });

    it('Drunk apparentRole is a Townsfolk not otherwise in the game', () => {
      const state = makeGameWithDrunk();
      const drunkPlayer = state.players.find((p) => p.id === 'p1')!;
      const otherRoles = state.players
        .filter((p) => p.id !== 'p1')
        .map((p) => p.trueRole);

      // Chef (apparent) is not held by any other player as their true role
      expect(otherRoles).not.toContain(drunkPlayer.apparentRole);
    });
  });

  describe('Drunk apparent ability fires in the night queue as normal', () => {
    it('Drunk appears in night queue under their apparentRole', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      const queue = state.nightQueue;
      const roleIds = queue.map((e) => e.roleId);

      // The Drunk (true: drunk, apparent: chef) should appear as "chef" in the queue
      expect(roleIds).toContain('chef');
      const chefEntry = queue.find((e) => e.roleId === 'chef');
      expect(chefEntry?.playerId).toBe('p1');
    });

    it('Drunk does not appear as "drunk" in the night queue', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      const roleIds = state.nightQueue.map((e) => e.roleId);
      expect(roleIds).not.toContain('drunk');
    });
  });

  describe('All results produced by the Drunk ability are corrupted (context.isDrunk is true)', () => {
    it('buildAbilityContext sets isDrunk to true for the Drunk player', () => {
      const state = makeGameWithDrunk();
      const context = buildAbilityContext(state, 'p1', 1);

      expect(context.isDrunk).toBe(true);
      expect(context.player.id).toBe('p1');
    });

    it('buildAbilityContext sets isDrunk to false for non-Drunk players', () => {
      const state = makeGameWithDrunk();
      const context = buildAbilityContext(state, 'p2', 1);

      expect(context.isDrunk).toBe(false);
    });

    it('isDrunk context flag is independent of isPoisoned', () => {
      const state = makeGameWithDrunk();
      const context = buildAbilityContext(state, 'p1', 1);

      // Drunk but not poisoned
      expect(context.isDrunk).toBe(true);
      expect(context.isPoisoned).toBe(false);
    });
  });

  describe('Storyteller manually provides false information for the Drunk night result', () => {
    it('Drunk night prompt uses the apparent role prompt type', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      // Advance to the Drunk's position in the queue (chef)
      const chefIdx = state.nightQueue.findIndex((e) => e.roleId === 'chef');
      state = { ...state, nightQueuePosition: chefIdx };

      const promptInfo = getNightPromptInfo(state);
      expect(promptInfo).not.toBeNull();
      // Chef prompt type is 'provide_number'
      expect(promptInfo!.promptType).toBe('provide_number');
      expect(promptInfo!.roleId).toBe('chef');
    });

    it('Storyteller input is stored via advanceNightQueue for Drunk ability', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      const chefIdx = state.nightQueue.findIndex((e) => e.roleId === 'chef');
      state = { ...state, nightQueuePosition: chefIdx };

      // The Storyteller provides false input (e.g., wrong evil pair count)
      const updated = advanceNightQueue(state, { evilPairCount: 99 });

      expect(updated.nightQueue[chefIdx].storytellerInput).toEqual({ evilPairCount: 99 });
      expect(updated.nightQueue[chefIdx].completed).toBe(true);
    });
  });

  describe('Drunk night prompt flags to the Storyteller that this player is the Drunk', () => {
    it('isDrunk is true in the night prompt info for the Drunk player', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      const chefIdx = state.nightQueue.findIndex((e) => e.roleId === 'chef');
      state = { ...state, nightQueuePosition: chefIdx };

      const promptInfo = getNightPromptInfo(state);
      expect(promptInfo).not.toBeNull();
      expect(promptInfo!.isDrunk).toBe(true);
    });

    it('isDrunk is false in the night prompt info for non-Drunk players', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      // Find empath in queue
      const empathIdx = state.nightQueue.findIndex((e) => e.roleId === 'empath');
      if (empathIdx >= 0) {
        state = { ...state, nightQueuePosition: empathIdx };
        const promptInfo = getNightPromptInfo(state);
        expect(promptInfo).not.toBeNull();
        expect(promptInfo!.isDrunk).toBe(false);
      }
    });

    it('prompt description includes a Drunk warning for the Storyteller', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      const chefIdx = state.nightQueue.findIndex((e) => e.roleId === 'chef');
      state = { ...state, nightQueuePosition: chefIdx };

      const promptInfo = getNightPromptInfo(state);
      expect(promptInfo).not.toBeNull();
      expect(promptInfo!.promptDescription).toContain('DRUNK');
      expect(promptInfo!.promptDescription).toContain('false information');
    });

    it('prompt description does not include Drunk warning for non-Drunk players', () => {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      const empathIdx = state.nightQueue.findIndex((e) => e.roleId === 'empath');
      if (empathIdx >= 0) {
        state = { ...state, nightQueuePosition: empathIdx };
        const promptInfo = getNightPromptInfo(state);
        expect(promptInfo).not.toBeNull();
        expect(promptInfo!.promptDescription).not.toContain('DRUNK');
      }
    });
  });

  describe('WebSocket integration', () => {
    let httpServer: ReturnType<typeof createServer>;
    let ioServer: Server;
    let stClient: ClientSocket;
    let store: GameStore;
    const PORT = 0;

    beforeEach(async () => {
      store = {
        games: new Map(),
      };
      httpServer = createServer();
      ioServer = new Server(httpServer);
      registerSocketHandlers(ioServer, store);

      await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : PORT;

      stClient = ioClient(`http://localhost:${port}`, { forceNew: true });
      await new Promise<void>((resolve) => stClient.on('connect', resolve));
    });

    afterEach(async () => {
      stClient?.disconnect();
      ioServer?.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    function setupDrunkGameAtChefPrompt() {
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      // Set the queue position directly to the Drunk's chef entry
      const chefIdx = state.nightQueue.findIndex((e) => e.roleId === 'chef');
      // Mark all preceding entries as completed
      const updatedQueue = state.nightQueue.map((entry, i) =>
        i < chefIdx ? { ...entry, completed: true } : entry
      );

      state = {
        ...state,
        storytellerId: stClient.id!,
        nightQueue: updatedQueue,
        nightQueuePosition: chefIdx,
      };
      store.games.set('g1', state);
      return state;
    }

    it('Storyteller receives isDrunk flag in night prompt for Drunk player via submit_night_action', async () => {
      // Set up game one step before the Drunk's position so submit advances to it
      let state = makeGameWithDrunk();
      state = transitionToNight(state);

      const chefIdx = state.nightQueue.findIndex((e) => e.roleId === 'chef');

      if (chefIdx === 0) {
        // Drunk is first — just check getNightPromptInfo directly (prompt sent via end_day, not submit)
        state = { ...state, storytellerId: stClient.id! };
        store.games.set('g1', state);
        const promptInfo = getNightPromptInfo(state);
        expect(promptInfo!.isDrunk).toBe(true);
        expect(promptInfo!.roleId).toBe('chef');
      } else {
        // Position one step before the Drunk
        const preIdx = chefIdx - 1;
        const updatedQueue = state.nightQueue.map((entry, i) =>
          i < preIdx ? { ...entry, completed: true } : entry
        );
        state = {
          ...state,
          storytellerId: stClient.id!,
          nightQueue: updatedQueue,
          nightQueuePosition: preIdx,
        };
        store.games.set('g1', state);
        store.playerSockets.set(stClient.id!, 'g1');

        // Submit action to advance to Drunk's position
        const prompt = await new Promise<Record<string, unknown>>((resolve) => {
          stClient.on('night_prompt', (data: Record<string, unknown>) => resolve(data));
          stClient.emit('submit_night_action', { gameId: 'g1', input: {} });
        });

        expect(prompt.isDrunk).toBe(true);
        expect(prompt.roleId).toBe('chef');
      }
    });

    it('Storyteller grimoire shows isDrunk for Drunk player after submit_night_action', async () => {
      setupDrunkGameAtChefPrompt();

      // Submit the Drunk's (chef) night action — Storyteller provides false info
      const grimoire = await new Promise<Record<string, unknown>>((resolve) => {
        stClient.on('grimoire', (data: Record<string, unknown>) => resolve(data));
        stClient.emit('submit_night_action', { gameId: 'g1', input: { evilPairCount: 99 } });
      });

      // Grimoire should show isDrunk for the Drunk player
      const players = grimoire.players as Array<Record<string, unknown>>;
      const drunkEntry = players.find((p) => p.playerId === 'p1');
      expect(drunkEntry).toBeDefined();
      expect(drunkEntry!.isDrunk).toBe(true);
    });
  });
});
