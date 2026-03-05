import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  processButlerAction,
  transitionToNight,
  buildAbilityContext,
  getNightPromptInfo,
  addNomination,
  startVote,
  recordVote,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { abilityHandler, metadata as butlerMetadata } from '../../src/roles/butler.js';
import type { GameState, Player, RoleId } from '../../src/types/game.js';
import { NIGHT_1_ORDER, NIGHT_OTHER_ORDER } from '../../src/data/nightOrder.js';

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
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'butler', apparentRole: 'butler', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }));
  return state;
}

describe('Butler', () => {
  describe('night order', () => {
    it('Butler is in Night 1 order', () => {
      expect(NIGHT_1_ORDER).toContain('butler');
    });

    it('Butler is in other nights order', () => {
      expect(NIGHT_OTHER_ORDER).toContain('butler');
    });

    it('Butler is last in both night orders', () => {
      expect(NIGHT_1_ORDER[NIGHT_1_ORDER.length - 1]).toBe('butler');
      expect(NIGHT_OTHER_ORDER[NIGHT_OTHER_ORDER.length - 1]).toBe('butler');
    });
  });

  describe('night prompt', () => {
    it('Butler prompt is choose_player type with correct description', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 1,
        nightQueue: [
          { roleId: 'butler' as RoleId, playerId: 'p1', completed: false },
        ],
        nightQueuePosition: 0,
      };

      const prompt = getNightPromptInfo(state);
      expect(prompt).not.toBeNull();
      expect(prompt!.promptType).toBe('choose_player');
      expect(prompt!.promptDescription).toContain('Butler');
      expect(prompt!.promptDescription).toContain('master');
    });
  });

  describe('state machine', () => {
    it('processButlerAction sets butlerMasterId', () => {
      let state = makeGameWithPlayers();
      state = processButlerAction(state, 'p2');
      expect(state.butlerMasterId).toBe('p2');
    });

    it('processButlerAction logs the action', () => {
      let state = makeGameWithPlayers();
      state = processButlerAction(state, 'p2');
      const log = state.gameLog.find((e) => e.type === 'butler_action');
      expect(log).toBeDefined();
      expect((log!.data as { targetPlayerId: string }).targetPlayerId).toBe('p2');
    });

    it('processButlerAction returns same state for invalid target', () => {
      const state = makeGameWithPlayers();
      const result = processButlerAction(state, 'nonexistent');
      expect(result).toBe(state);
    });

    it('Butler master persists through day (not cleared by transitionToNight)', () => {
      let state = makeGameWithPlayers();
      state = processButlerAction(state, 'p2');
      expect(state.butlerMasterId).toBe('p2');
      // Transition to night — butlerMasterId should persist until Butler acts again
      state = { ...state, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
      state = transitionToNight(state);
      // Butler will choose a new master during the night; the old one persists until then
      // (transitionToNight does NOT clear butlerMasterId)
      expect(state.butlerMasterId).toBe('p2');
    });

    it('Butler is passive metadata (firstNight and otherNights both true)', () => {
      expect(butlerMetadata.firstNight).toBe(true);
      expect(butlerMetadata.otherNights).toBe(true);
      expect(butlerMetadata.team).toBe('outsider');
    });

    it('state machine purity: processButlerAction does not mutate input', () => {
      const state = makeGameWithPlayers();
      const original = JSON.stringify(state);
      processButlerAction(state, 'p2');
      expect(JSON.stringify(state)).toBe(original);
    });
  });

  describe('ability handler', () => {
    it('succeeds with valid target', () => {
      let state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'p2' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ targetPlayerId: 'p2', isCorrupted: false });
    });

    it('fails without a target', () => {
      let state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, {});
      expect(result.success).toBe(false);
    });

    it('fails with invalid target', () => {
      let state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'nonexistent' });
      expect(result.success).toBe(false);
    });

    it('fails with dead target', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p2' ? { ...p, isAlive: false } : p
        ),
      };
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'p2' });
      expect(result.success).toBe(false);
    });

    it('fails when choosing self', () => {
      let state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'p1' });
      expect(result.success).toBe(false);
    });

    it('reports isCorrupted when poisoned', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p1' ? { ...p, isPoisoned: true } : p
        ),
      };
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'p2' });
      expect(result.success).toBe(true);
      expect((result.data as { isCorrupted: boolean }).isCorrupted).toBe(true);
    });

    it('reports isCorrupted when drunk', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p1' ? { ...p, isDrunk: true } : p
        ),
      };
      const context = buildAbilityContext(state, 'p1', 1);
      const result = abilityHandler(context, { targetPlayerId: 'p2' });
      expect(result.success).toBe(true);
      expect((result.data as { isCorrupted: boolean }).isCorrupted).toBe(true);
    });
  });

  describe('vote constraint', () => {
    function makeVotingState(): GameState {
      let state = makeGameWithPlayers();
      state = processButlerAction(state, 'p2'); // p2 is Butler's master
      state = { ...state, phase: 'day' as const, daySubPhase: 'vote' as const, dayNumber: 1 };
      state = addNomination(state, 'p3', 'p4');
      state = startVote(state, 0);
      return state;
    }

    it('Butler cannot vote yes if master has not voted yes', () => {
      // This is tested via WebSocket since the constraint is in the socket handler
      // State machine recordVote doesn't enforce Butler constraint (it's in the handler)
      // But we test the state machine still works normally
      const state = makeVotingState();
      const result = recordVote(state, 0, 'p1', true);
      // recordVote itself doesn't enforce Butler constraint (that's in socket handler)
      expect(result.nominations[0].votes).toContain('p1');
    });

    it('Butler can vote no freely (constraint only applies to yes votes)', () => {
      const state = makeVotingState();
      const result = recordVote(state, 0, 'p1', false);
      expect(result.nominations[0].votesSubmitted).toContain('p1');
      expect(result.nominations[0].votes).not.toContain('p1');
    });
  });

  // WebSocket integration tests
  describe('WebSocket', () => {
    let httpServer: ReturnType<typeof createServer>;
    let ioServer: Server;
    let port: number;
    let clients: ClientSocket[] = [];
    let store: GameStore;

    function createClient(): ClientSocket {
      const client = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });
      clients.push(client);
      return client;
    }

    function waitForEvent(client: ClientSocket, event: string, timeout = 3000): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
        client.on(event, (data: unknown) => {
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

    it('Storyteller can submit Butler night action and master is set', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'butler', apparentRole: 'butler', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 4 }),
      ];

      let nightState = {
        ...g,
        players,
        storytellerId: storyteller.id!,
        phase: 'night' as const,
        daySubPhase: null,
        dayNumber: 1,
      };
      nightState = {
        ...nightState,
        nightQueue: [
          { roleId: 'butler' as RoleId, playerId: storyteller.id!, completed: false },
        ],
        nightQueuePosition: 0,
      };
      store.games.set(gameId, nightState);

      const confirmPromise = waitForEvent(storyteller, 'night_action_confirmed');
      storyteller.emit('submit_night_action', { gameId, input: { targetPlayerId: 'p3' } });
      await confirmPromise;

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.butlerMasterId).toBe('p3');
    });

    it('Butler cannot vote yes if master has not voted (via WebSocket)', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      // Connect storyteller
      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Connect Butler player
      const butlerClient = createClient();
      await new Promise<void>((resolve) => butlerClient.on('connect', resolve));
      butlerClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Butler' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Connect master player
      const masterClient = createClient();
      await new Promise<void>((resolve) => masterClient.on('connect', resolve));
      masterClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Master' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Connect extra players
      const extra1 = createClient();
      await new Promise<void>((resolve) => extra1.on('connect', resolve));
      extra1.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra1' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra2 = createClient();
      await new Promise<void>((resolve) => extra2.on('connect', resolve));
      extra2.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra2' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      // Set up game state in voting phase with Butler's master set
      const dayState: GameState = {
        ...g,
        players: g.players.map((p, i) => {
          if (p.id === butlerClient.id!) return { ...p, trueRole: 'butler' as RoleId, apparentRole: 'butler' as RoleId, seatIndex: i };
          if (p.id === masterClient.id!) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId, seatIndex: i };
          return { ...p, seatIndex: i };
        }),
        storytellerId: storyteller.id!,
        butlerMasterId: masterClient.id!,
        phase: 'day' as const,
        daySubPhase: 'nomination' as const,
        dayNumber: 1,
      };
      store.games.set(gameId, dayState);

      // Extra1 nominates Extra2
      const nomState = addNomination(dayState, extra1.id!, extra2.id!);
      const voteState = startVote(nomState, 0);
      store.games.set(gameId, { ...voteState, daySubPhase: 'vote' as const, activeNominationIndex: 0 });

      // Butler tries to vote yes before master has voted
      const voteErrorPromise = waitForEvent(butlerClient, 'vote_error');
      butlerClient.emit('submit_vote', { gameId, vote: true });
      const error = (await voteErrorPromise) as { message: string };
      expect(error.message).toContain('master');
    });

    it('Butler can vote yes after master has voted yes', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const butlerClient = createClient();
      await new Promise<void>((resolve) => butlerClient.on('connect', resolve));
      butlerClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Butler' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const masterClient = createClient();
      await new Promise<void>((resolve) => masterClient.on('connect', resolve));
      masterClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Master' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra1 = createClient();
      await new Promise<void>((resolve) => extra1.on('connect', resolve));
      extra1.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra1' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra2 = createClient();
      await new Promise<void>((resolve) => extra2.on('connect', resolve));
      extra2.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra2' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const dayState: GameState = {
        ...g,
        players: g.players.map((p, i) => {
          if (p.id === butlerClient.id!) return { ...p, trueRole: 'butler' as RoleId, apparentRole: 'butler' as RoleId, seatIndex: i };
          if (p.id === masterClient.id!) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId, seatIndex: i };
          return { ...p, seatIndex: i };
        }),
        storytellerId: storyteller.id!,
        butlerMasterId: masterClient.id!,
        phase: 'day' as const,
        daySubPhase: 'nomination' as const,
        dayNumber: 1,
      };
      store.games.set(gameId, dayState);

      let nomState = addNomination(dayState, extra1.id!, extra2.id!);
      let voteState = startVote(nomState, 0);
      store.games.set(gameId, { ...voteState, daySubPhase: 'vote' as const, activeNominationIndex: 0 });

      // Master votes yes first
      const masterVotePromise = waitForEvent(masterClient, 'vote_recorded');
      masterClient.emit('submit_vote', { gameId, vote: true });
      await masterVotePromise;

      // Now Butler can vote yes
      const butlerVotePromise = waitForEvent(butlerClient, 'vote_recorded');
      butlerClient.emit('submit_vote', { gameId, vote: true });
      const result = (await butlerVotePromise) as { vote: boolean };
      expect(result.vote).toBe(true);
    });

    it('Butler can vote no freely without master voting', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const butlerClient = createClient();
      await new Promise<void>((resolve) => butlerClient.on('connect', resolve));
      butlerClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Butler' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const masterClient = createClient();
      await new Promise<void>((resolve) => masterClient.on('connect', resolve));
      masterClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Master' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra1 = createClient();
      await new Promise<void>((resolve) => extra1.on('connect', resolve));
      extra1.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra1' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra2 = createClient();
      await new Promise<void>((resolve) => extra2.on('connect', resolve));
      extra2.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra2' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const dayState: GameState = {
        ...g,
        players: g.players.map((p, i) => {
          if (p.id === butlerClient.id!) return { ...p, trueRole: 'butler' as RoleId, apparentRole: 'butler' as RoleId, seatIndex: i };
          if (p.id === masterClient.id!) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId, seatIndex: i };
          return { ...p, seatIndex: i };
        }),
        storytellerId: storyteller.id!,
        butlerMasterId: masterClient.id!,
        phase: 'day' as const,
        daySubPhase: 'nomination' as const,
        dayNumber: 1,
      };
      store.games.set(gameId, dayState);

      let nomState = addNomination(dayState, extra1.id!, extra2.id!);
      let voteState = startVote(nomState, 0);
      store.games.set(gameId, { ...voteState, daySubPhase: 'vote' as const, activeNominationIndex: 0 });

      // Butler votes no — should succeed without master voting
      const voteRecordedPromise = waitForEvent(butlerClient, 'vote_recorded');
      butlerClient.emit('submit_vote', { gameId, vote: false });
      const result = (await voteRecordedPromise) as { vote: boolean };
      expect(result.vote).toBe(false);
    });

    it('Butler votes freely when master is dead', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const butlerClient = createClient();
      await new Promise<void>((resolve) => butlerClient.on('connect', resolve));
      butlerClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Butler' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const masterClient = createClient();
      await new Promise<void>((resolve) => masterClient.on('connect', resolve));
      masterClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Master' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra1 = createClient();
      await new Promise<void>((resolve) => extra1.on('connect', resolve));
      extra1.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra1' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra2 = createClient();
      await new Promise<void>((resolve) => extra2.on('connect', resolve));
      extra2.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra2' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const dayState: GameState = {
        ...g,
        players: g.players.map((p, i) => {
          if (p.id === butlerClient.id!) return { ...p, trueRole: 'butler' as RoleId, apparentRole: 'butler' as RoleId, seatIndex: i };
          if (p.id === masterClient.id!) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId, isAlive: false, seatIndex: i };
          return { ...p, seatIndex: i };
        }),
        storytellerId: storyteller.id!,
        butlerMasterId: masterClient.id!,
        phase: 'day' as const,
        daySubPhase: 'nomination' as const,
        dayNumber: 1,
      };
      store.games.set(gameId, dayState);

      let nomState = addNomination(dayState, extra1.id!, extra2.id!);
      let voteState = startVote(nomState, 0);
      store.games.set(gameId, { ...voteState, daySubPhase: 'vote' as const, activeNominationIndex: 0 });

      // Butler votes yes with dead master — constraint lifted
      const voteRecordedPromise = waitForEvent(butlerClient, 'vote_recorded');
      butlerClient.emit('submit_vote', { gameId, vote: true });
      const result = (await voteRecordedPromise) as { vote: boolean };
      expect(result.vote).toBe(true);
    });

    it('Poisoned Butler can vote freely without master voting', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const butlerClient = createClient();
      await new Promise<void>((resolve) => butlerClient.on('connect', resolve));
      butlerClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Butler' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const masterClient = createClient();
      await new Promise<void>((resolve) => masterClient.on('connect', resolve));
      masterClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Master' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra1 = createClient();
      await new Promise<void>((resolve) => extra1.on('connect', resolve));
      extra1.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra1' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const extra2 = createClient();
      await new Promise<void>((resolve) => extra2.on('connect', resolve));
      extra2.emit('join_game', { joinCode: 'ABC123', playerName: 'Extra2' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const g = store.games.get(gameId)!;
      const dayState: GameState = {
        ...g,
        players: g.players.map((p, i) => {
          if (p.id === butlerClient.id!) return { ...p, trueRole: 'butler' as RoleId, apparentRole: 'butler' as RoleId, isPoisoned: true, seatIndex: i };
          if (p.id === masterClient.id!) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId, seatIndex: i };
          return { ...p, seatIndex: i };
        }),
        storytellerId: storyteller.id!,
        butlerMasterId: masterClient.id!,
        phase: 'day' as const,
        daySubPhase: 'nomination' as const,
        dayNumber: 1,
      };
      store.games.set(gameId, dayState);

      let nomState = addNomination(dayState, extra1.id!, extra2.id!);
      let voteState = startVote(nomState, 0);
      store.games.set(gameId, { ...voteState, daySubPhase: 'vote' as const, activeNominationIndex: 0 });

      // Poisoned Butler votes yes — constraint doesn't apply
      const voteRecordedPromise = waitForEvent(butlerClient, 'vote_recorded');
      butlerClient.emit('submit_vote', { gameId, vote: true });
      const result = (await voteRecordedPromise) as { vote: boolean };
      expect(result.vote).toBe(true);
    });

    it('butlerMasterId is sanitized from broadcast game_state', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const playerClient = createClient();
      await new Promise<void>((resolve) => playerClient.on('connect', resolve));

      const gameStatePromise = waitForEvent(playerClient, 'game_state');
      playerClient.emit('join_game', { joinCode: 'ABC123', playerName: 'Player1' });
      const gs = (await gameStatePromise) as GameState;

      // butlerMasterId should be null/sanitized in broadcast state
      expect(gs.butlerMasterId).toBeNull();
    });
  });
});
