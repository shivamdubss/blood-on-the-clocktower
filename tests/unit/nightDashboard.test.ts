import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  transitionToNight,
  getNightPromptInfo,
  advanceNightQueue,
  resolveDawnDeaths,
  transitionDaySubPhase,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, Player, RoleId, NightPromptInfo } from '../../src/types/game.js';

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

describe('night dashboard', () => {
  describe('state machine', () => {
    it('getNightPromptInfo returns prompt for the current queue position', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.queuePosition).toBe(0);
      expect(prompt!.totalInQueue).toBe(state.nightQueue.length);
      expect(prompt!.roleId).toBe(state.nightQueue[0].roleId);
      expect(prompt!.playerName).toBeTruthy();
      expect(prompt!.ability).toBeTruthy();
      expect(prompt!.promptType).toBeTruthy();
      expect(prompt!.promptDescription).toBeTruthy();
    });

    it('getNightPromptInfo returns null when queue is complete', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);
      // Advance past all entries
      state = { ...state, nightQueuePosition: state.nightQueue.length };

      const prompt = getNightPromptInfo(state);
      expect(prompt).toBeNull();
    });

    it('getNightPromptInfo shows isDrunk flag for Drunk players', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      const players = makePlayers(7, ['poisoner', 'imp', 'drunk', 'librarian', 'empath', 'chef', 'fortuneTeller']);
      // Drunk thinks they are washerwoman
      players[2].apparentRole = 'washerwoman';
      players[2].isDrunk = true;
      state = { ...state, players };
      state = transitionToNight(state);

      // Find the entry for the Drunk's apparent role (washerwoman)
      const drunkEntry = state.nightQueue.find(e => e.playerId === 'player-2');
      expect(drunkEntry).toBeDefined();

      // Move to the Drunk's position
      state = { ...state, nightQueuePosition: state.nightQueue.indexOf(drunkEntry!) };
      const prompt = getNightPromptInfo(state);

      expect(prompt).not.toBeNull();
      expect(prompt!.isDrunk).toBe(true);
      expect(prompt!.playerName).toBe('Player 2');
    });

    it('getNightPromptInfo shows isPoisoned flag for poisoned players', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      const players = makePlayers(7);
      state = { ...state, players };
      state = transitionToNight(state);

      // Set isPoisoned AFTER transitionToNight (which clears poison),
      // simulating the Poisoner having already acted in the queue
      const washEntry = state.nightQueue.find(e => e.roleId === 'washerwoman');
      if (washEntry) {
        const poisonedPlayers = state.players.map(p =>
          p.id === washEntry.playerId ? { ...p, isPoisoned: true } : p
        );
        state = { ...state, players: poisonedPlayers, nightQueuePosition: state.nightQueue.indexOf(washEntry) };
        const prompt = getNightPromptInfo(state);
        expect(prompt).not.toBeNull();
        expect(prompt!.isPoisoned).toBe(true);
      }
    });

    it('advanceNightQueue marks current entry as completed and moves position', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      expect(state.nightQueuePosition).toBe(0);
      expect(state.nightQueue[0].completed).toBe(false);

      const input = { targetPlayerId: 'player-3' };
      const result = advanceNightQueue(state, input);

      expect(result.nightQueuePosition).toBe(1);
      expect(result.nightQueue[0].completed).toBe(true);
      expect(result.nightQueue[0].storytellerInput).toEqual(input);
    });

    it('advanceNightQueue does not advance past the end of the queue', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);
      state = { ...state, nightQueuePosition: state.nightQueue.length };

      const result = advanceNightQueue(state);
      expect(result.nightQueuePosition).toBe(state.nightQueue.length);
    });

    it('advanceNightQueue adds a game log entry', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);
      const logBefore = state.gameLog.length;

      const result = advanceNightQueue(state);
      expect(result.gameLog.length).toBe(logBefore + 1);
      expect(result.gameLog[result.gameLog.length - 1].type).toBe('night_action_confirmed');
    });

    it('Storyteller can step through the entire queue sequentially', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);
      const queueLength = state.nightQueue.length;

      for (let i = 0; i < queueLength; i++) {
        const prompt = getNightPromptInfo(state);
        expect(prompt).not.toBeNull();
        expect(prompt!.queuePosition).toBe(i);
        state = advanceNightQueue(state, { step: i });
      }

      // Queue is now complete
      const finalPrompt = getNightPromptInfo(state);
      expect(finalPrompt).toBeNull();
      expect(state.nightQueuePosition).toBe(queueLength);

      // All entries marked complete
      for (const entry of state.nightQueue) {
        expect(entry.completed).toBe(true);
      }
    });

    it('prompt includes correct promptType for different roles', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      // Check each entry has a valid promptType
      for (let i = 0; i < state.nightQueue.length; i++) {
        state = { ...state, nightQueuePosition: i };
        const prompt = getNightPromptInfo(state);
        expect(prompt).not.toBeNull();
        expect(['choose_player', 'choose_two_players', 'provide_number', 'choose_players_and_role', 'info_only']).toContain(prompt!.promptType);
      }
    });

    it('prompt shows relevant role information (name, ability, player)', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();

      // The first in queue for 7 players should be poisoner (Night 1 order)
      expect(prompt!.roleId).toBe('poisoner');
      expect(prompt!.roleName).toBe('Poisoner');
      expect(prompt!.ability).toContain('poisoned');
      expect(prompt!.playerName).toBe('Player 0');
      expect(prompt!.promptType).toBe('choose_player');
      expect(prompt!.promptDescription).toContain('Poisoner');
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

    it('Storyteller receives night_prompt when night begins (via end_day)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      // Join room
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Override state to day/end with roles that have night actions
      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'day',
        daySubPhase: 'end',
        dayNumber: 1,
        players: makePlayers(7),
      });

      const promptPromise = waitForEvent(storyteller, 'night_prompt');
      storyteller.emit('end_day', { gameId });

      const prompt = await promptPromise as NightPromptInfo;
      expect(prompt.queuePosition).toBe(0);
      expect(prompt.roleId).toBeTruthy();
      expect(prompt.roleName).toBeTruthy();
      expect(prompt.ability).toBeTruthy();
      expect(prompt.playerName).toBeTruthy();
      expect(prompt.promptType).toBeTruthy();
      expect(prompt.promptDescription).toBeTruthy();
    });

    it('Storyteller receives night_queue_empty when no roles in queue', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Use roles with no night actions (all passive)
      const passiveRoles: RoleId[] = ['soldier', 'virgin', 'saint', 'recluse', 'mayor', 'slayer', 'baron'];
      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'day',
        daySubPhase: 'end',
        dayNumber: 1,
        players: makePlayers(7, passiveRoles),
      });

      const emptyPromise = waitForEvent(storyteller, 'night_queue_empty');
      storyteller.emit('end_day', { gameId });

      await emptyPromise; // Resolves if event is received
    });

    it('submit_night_action advances queue and sends next prompt', async () => {
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
        daySubPhase: 'end',
        dayNumber: 1,
        players: makePlayers(7),
      });

      // Wait for first prompt
      const firstPrompt = waitForEvent(storyteller, 'night_prompt');
      storyteller.emit('end_day', { gameId });
      const prompt1 = await firstPrompt as NightPromptInfo;
      expect(prompt1.queuePosition).toBe(0);

      // Submit action and get next prompt
      const nextPrompt = waitForEvent(storyteller, 'night_prompt');
      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'player-3' } });

      const confirmed = await confirmPromise as { queuePosition: number; roleId: string };
      expect(confirmed.queuePosition).toBe(0);

      const prompt2 = await nextPrompt as NightPromptInfo;
      expect(prompt2.queuePosition).toBe(1);
    });

    it('queue does not advance until Storyteller confirms each step', async () => {
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
        daySubPhase: 'end',
        dayNumber: 1,
        players: makePlayers(7),
      });

      // Start night
      const firstPrompt = waitForEvent(storyteller, 'night_prompt');
      storyteller.emit('end_day', { gameId });
      await firstPrompt;

      // Verify position hasn't advanced without submit
      const gameState = store.games.get(gameId)!;
      expect(gameState.nightQueuePosition).toBe(0);
      expect(gameState.nightQueue[0].completed).toBe(false);

      // Now submit and verify advancement
      const nextPrompt = waitForEvent(storyteller, 'night_prompt');
      storyteller.emit('submit_night_action', { gameId, input: {} });
      await nextPrompt;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.nightQueuePosition).toBe(1);
      expect(updatedState.nightQueue[0].completed).toBe(true);
    });

    it('non-Storyteller cannot submit night actions', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const player = createClient();
      await new Promise<void>((resolve) => player.on('connect', resolve));
      player.emit('join_game', { joinCode: 'ABC123', playerName: 'P1' });
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

      const errorPromise = waitForEvent(player, 'night_action_error');
      player.emit('submit_night_action', { gameId, input: {} });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Only the Storyteller can submit night actions');
    });

    it('cannot submit night action during day phase', async () => {
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

      const errorPromise = waitForEvent(storyteller, 'night_action_error');
      storyteller.emit('submit_night_action', { gameId, input: {} });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Can only submit night actions during the night phase');
    });

    it('submit_night_action emits night_queue_empty when queue is complete', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Set up night with only 1 entry in queue
      const g = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...g,
        storytellerId: storyteller.id!,
        phase: 'night',
        nightQueue: [{ roleId: 'poisoner', playerId: 'player-0', completed: false }],
        nightQueuePosition: 0,
        players: makePlayers(7),
      });

      const emptyPromise = waitForEvent(storyteller, 'night_queue_empty');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'player-1' } });

      await emptyPromise; // Resolves when queue is complete
    });

    it('Storyteller input is stored on the night queue entry', async () => {
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

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');
      const inputData = { targetPlayerId: 'player-3', notes: 'poisoning the empath' };
      storyteller.emit('submit_night_action', { gameId, input: inputData });
      await confirmPromise;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.nightQueue[0].storytellerInput).toEqual(inputData);
      expect(updatedState.nightQueue[0].completed).toBe(true);
    });
  });
});
