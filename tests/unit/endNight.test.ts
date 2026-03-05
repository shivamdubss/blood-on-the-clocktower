import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  transitionToNight,
  advanceNightQueue,
  revertNightQueueStep,
  commitNightActions,
  addPendingDeath,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';

function makePlayers(count: number, roles?: RoleId[]): Player[] {
  const defaultRoles: RoleId[] = [
    'poisoner', 'imp', 'washerwoman', 'librarian', 'empath',
    'chef', 'fortuneTeller', 'monk', 'butler', 'spy',
    'investigator', 'undertaker', 'ravenkeeper', 'slayer', 'soldier',
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `player-${i}`,
    name: `Player ${i}`,
    trueRole: (roles ? roles[i] : defaultRoles[i]) ?? ('washerwoman' as const),
    apparentRole: (roles ? roles[i] : defaultRoles[i]) ?? ('washerwoman' as const),
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex: i,
  }));
}

describe('end night', () => {
  describe('state machine', () => {
    it('commitNightActions adds a night_committed log entry', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      // Advance through some actions
      state = advanceNightQueue(state, { target: 'player-3' });
      state = advanceNightQueue(state, { target: 'player-4' });

      const logBefore = state.gameLog.length;
      const committed = commitNightActions(state);

      expect(committed.gameLog.length).toBe(logBefore + 1);
      const lastLog = committed.gameLog[committed.gameLog.length - 1];
      expect(lastLog.type).toBe('night_committed');
      expect((lastLog.data as { nightQueue: unknown[] }).nightQueue).toBeDefined();
    });

    it('revertNightQueueStep decrements position and unmarks the entry', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      // Advance two steps
      state = advanceNightQueue(state, { target: 'player-3' });
      state = advanceNightQueue(state, { target: 'player-4' });
      expect(state.nightQueuePosition).toBe(2);

      // Revert one step
      const reverted = revertNightQueueStep(state);
      expect(reverted.nightQueuePosition).toBe(1);
      expect(reverted.nightQueue[1].completed).toBe(false);
      expect(reverted.nightQueue[1].storytellerInput).toBeUndefined();
      // First entry should still be completed
      expect(reverted.nightQueue[0].completed).toBe(true);
    });

    it('revertNightQueueStep does nothing when at position 0', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      const result = revertNightQueueStep(state);
      expect(result.nightQueuePosition).toBe(0);
      expect(result).toBe(state); // No change, returns same reference
    });

    it('revertNightQueueStep adds a game log entry', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);
      state = advanceNightQueue(state, { target: 'player-3' });

      const logBefore = state.gameLog.length;
      const reverted = revertNightQueueStep(state);
      expect(reverted.gameLog.length).toBe(logBefore + 1);
      expect(reverted.gameLog[reverted.gameLog.length - 1].type).toBe('night_action_reverted');
    });

    it('actions are reversible: advance then revert restores previous state', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      const positionBefore = state.nightQueuePosition;
      state = advanceNightQueue(state, { target: 'player-3' });
      state = revertNightQueueStep(state);

      expect(state.nightQueuePosition).toBe(positionBefore);
      expect(state.nightQueue[positionBefore].completed).toBe(false);
      expect(state.nightQueue[positionBefore].storytellerInput).toBeUndefined();
    });

    it('commitNightActions records all queue entries in the log', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      // Complete all queue entries
      while (state.nightQueuePosition < state.nightQueue.length) {
        state = advanceNightQueue(state, { step: state.nightQueuePosition });
      }

      const committed = commitNightActions(state);
      const lastLog = committed.gameLog[committed.gameLog.length - 1];
      const logData = lastLog.data as { nightQueue: { roleId: string; completed: boolean }[] };
      expect(logData.nightQueue.length).toBe(state.nightQueue.length);
      for (const entry of logData.nightQueue) {
        expect(entry.completed).toBe(true);
      }
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

    it('Storyteller can end night and dawn announcement fires', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Set up night phase with pending deaths
      const g = store.games.get(gameId)!;
      let nightState: GameState = {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'night',
        dayNumber: 1,
        nightQueue: [{ roleId: 'imp', playerId: 'player-1', completed: true }],
        nightQueuePosition: 1,
        players: makePlayers(7),
        pendingDeaths: ['player-3'],
      };
      store.games.set(gameId, nightState);

      const dawnPromise = waitForEvent(storyteller, 'dawn_announcement');
      const nightEndedPromise = waitForEvent(storyteller, 'night_ended');
      storyteller.emit('end_night', { gameId });

      const nightEnded = await nightEndedPromise as { dayNumber: number };
      expect(nightEnded.dayNumber).toBe(2);

      const dawn = await dawnPromise as { deaths: { playerId: string; playerName: string }[]; dayNumber: number };
      expect(dawn.deaths.length).toBe(1);
      expect(dawn.deaths[0].playerId).toBe('player-3');
      expect(dawn.dayNumber).toBe(2);
    });

    it('end_night commits night actions to the game log', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'night',
        dayNumber: 1,
        nightQueue: [
          { roleId: 'poisoner', playerId: 'player-0', completed: true, storytellerInput: { target: 'player-2' } },
          { roleId: 'imp', playerId: 'player-1', completed: true, storytellerInput: { target: 'player-3' } },
        ],
        nightQueuePosition: 2,
        players: makePlayers(7),
        pendingDeaths: [],
      });

      const nightEndedPromise = waitForEvent(storyteller, 'night_ended');
      storyteller.emit('end_night', { gameId });
      await nightEndedPromise;

      const updatedState = store.games.get(gameId)!;
      const commitLog = updatedState.gameLog.find((l) => l.type === 'night_committed');
      expect(commitLog).toBeDefined();
    });

    it('non-Storyteller cannot end the night', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const player = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => player.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      player.emit('join_game', { joinCode: 'ABC123', playerName: 'P1' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'night',
        nightQueue: [],
        nightQueuePosition: 0,
        players: makePlayers(7),
      });

      const errorPromise = waitForEvent(player, 'end_night_error');
      player.emit('end_night', { gameId });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Only the Storyteller can end the night');
    });

    it('cannot end night during day phase', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'day',
        daySubPhase: 'discussion',
      });

      const errorPromise = waitForEvent(storyteller, 'end_night_error');
      storyteller.emit('end_night', { gameId });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Can only end night during the night phase');
    });

    it('undo_night_action reverts the last action and sends updated prompt', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = makePlayers(7);
      let nightState: GameState = {
        ...g,
        storytellerId: storyteller.id!,
        players,
      };
      nightState = transitionToNight(nightState);
      // Advance one step
      nightState = advanceNightQueue(nightState, { target: 'player-3' });
      store.games.set(gameId, nightState);

      const promptPromise = waitForEvent(storyteller, 'night_prompt');
      const revertedPromise = waitForEvent(storyteller, 'night_action_reverted');
      storyteller.emit('undo_night_action', { gameId });

      const reverted = await revertedPromise as { queuePosition: number };
      expect(reverted.queuePosition).toBe(0);

      const prompt = await promptPromise as { queuePosition: number };
      expect(prompt.queuePosition).toBe(0);

      // Verify state was reverted
      const updatedState = store.games.get(gameId)!;
      expect(updatedState.nightQueuePosition).toBe(0);
      expect(updatedState.nightQueue[0].completed).toBe(false);
    });

    it('undo_night_action errors when no actions to undo', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'night',
        nightQueue: [{ roleId: 'poisoner', playerId: 'player-0', completed: false }],
        nightQueuePosition: 0,
        players: makePlayers(7),
      });

      const errorPromise = waitForEvent(storyteller, 'night_action_error');
      storyteller.emit('undo_night_action', { gameId });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('No night actions to undo');
    });

    it('end_night transitions game to day phase', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'night',
        dayNumber: 1,
        nightQueue: [],
        nightQueuePosition: 0,
        players: makePlayers(7),
        pendingDeaths: [],
      });

      const statePromise = waitForEvent(storyteller, 'game_state');
      storyteller.emit('end_night', { gameId });
      await statePromise;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.phase).toBe('day');
      expect(updatedState.daySubPhase).toBe('dawn');
      expect(updatedState.dayNumber).toBe(2);
    });

    it('all clients receive dawn announcement after end_night', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const player1 = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => player1.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      player1.emit('join_game', { joinCode: 'ABC123', playerName: 'P1' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'night',
        dayNumber: 1,
        nightQueue: [],
        nightQueuePosition: 0,
        players: makePlayers(7),
        pendingDeaths: ['player-2'],
      });

      const stDawnPromise = waitForEvent(storyteller, 'dawn_announcement');
      const p1DawnPromise = waitForEvent(player1, 'dawn_announcement');
      storyteller.emit('end_night', { gameId });

      const stDawn = await stDawnPromise as { deaths: unknown[] };
      const p1Dawn = await p1DawnPromise as { deaths: unknown[] };

      expect(stDawn.deaths.length).toBe(1);
      expect(p1Dawn.deaths.length).toBe(1);
    });

    it('night actions are reversible until end_night is confirmed', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Set up night with queue
      const g = store.games.get(gameId)!;
      const players = makePlayers(7);
      let nightState: GameState = {
        ...g,
        storytellerId: storyteller.id!,
        players,
      };
      nightState = transitionToNight(nightState);
      store.games.set(gameId, nightState);

      // Advance through first action
      const promptPromise1 = waitForEvent(storyteller, 'night_prompt');
      storyteller.emit('submit_night_action', { gameId, input: { target: 'player-3' } });
      await waitForEvent(storyteller, 'night_action_confirmed');
      await promptPromise1;

      // Verify action was recorded
      let currentState = store.games.get(gameId)!;
      expect(currentState.nightQueuePosition).toBe(1);
      expect(currentState.nightQueue[0].completed).toBe(true);

      // Now undo it
      const undoPromptPromise = waitForEvent(storyteller, 'night_prompt');
      storyteller.emit('undo_night_action', { gameId });
      await waitForEvent(storyteller, 'night_action_reverted');
      await undoPromptPromise;

      // Verify it was reverted
      currentState = store.games.get(gameId)!;
      expect(currentState.nightQueuePosition).toBe(0);
      expect(currentState.nightQueue[0].completed).toBe(false);
      expect(currentState.nightQueue[0].storytellerInput).toBeUndefined();

      // Re-submit with different input
      storyteller.emit('submit_night_action', { gameId, input: { target: 'player-5' } });
      await waitForEvent(storyteller, 'night_action_confirmed');

      currentState = store.games.get(gameId)!;
      expect(currentState.nightQueue[0].storytellerInput).toEqual({ target: 'player-5' });
    });
  });
});
