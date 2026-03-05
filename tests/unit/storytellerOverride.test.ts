import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  applyStorytellerOverride,
  transitionToNight,
  advanceNightQueue,
  addPendingDeath,
  transitionPhase,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, Player, RoleId, StorytellerOverride } from '../../src/types/game.js';

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

describe('storyteller override', () => {
  describe('state machine', () => {
    it('kill_player override kills a player and logs it', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      const result = applyStorytellerOverride(state, { type: 'kill_player', playerId: 'player-2' });
      expect(result.players[2].isAlive).toBe(false);
      const lastLog = result.gameLog[result.gameLog.length - 1];
      expect(lastLog.type).toBe('storyteller_override');
      expect((lastLog.data as { overrideType: string }).overrideType).toBe('kill_player');
    });

    it('revive_player override revives a dead player', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      const players = makePlayers(7);
      players[3].isAlive = false;
      state = { ...state, players };

      const result = applyStorytellerOverride(state, { type: 'revive_player', playerId: 'player-3' });
      expect(result.players[3].isAlive).toBe(true);
    });

    it('set_poison override poisons a player', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      const result = applyStorytellerOverride(state, { type: 'set_poison', playerId: 'player-4' });
      expect(result.players[4].isPoisoned).toBe(true);
    });

    it('clear_poison override removes poison from a player', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      const players = makePlayers(7);
      players[4].isPoisoned = true;
      state = { ...state, players };

      const result = applyStorytellerOverride(state, { type: 'clear_poison', playerId: 'player-4' });
      expect(result.players[4].isPoisoned).toBe(false);
    });

    it('add_pending_death override adds a pending death', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      const result = applyStorytellerOverride(state, { type: 'add_pending_death', playerId: 'player-2' });
      expect(result.pendingDeaths).toContain('player-2');
    });

    it('remove_pending_death override removes a pending death', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = addPendingDeath(state, 'player-2');
      state = addPendingDeath(state, 'player-5');

      const result = applyStorytellerOverride(state, { type: 'remove_pending_death', playerId: 'player-2' });
      expect(result.pendingDeaths).not.toContain('player-2');
      expect(result.pendingDeaths).toContain('player-5');
    });

    it('modify_night_action override changes storytellerInput for a queue entry', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);
      state = advanceNightQueue(state, { target: 'player-3' });

      const result = applyStorytellerOverride(state, {
        type: 'modify_night_action',
        queuePosition: 0,
        storytellerInput: { target: 'player-5' },
      });
      expect(result.nightQueue[0].storytellerInput).toEqual({ target: 'player-5' });
    });

    it('set_player_role override changes a player\'s role', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      const result = applyStorytellerOverride(state, {
        type: 'set_player_role',
        playerId: 'player-2',
        roleId: 'imp',
      });
      expect(result.players[2].trueRole).toBe('imp');
      expect(result.players[2].apparentRole).toBe('imp');
    });

    it('set_player_role override can set different apparentRole', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      const result = applyStorytellerOverride(state, {
        type: 'set_player_role',
        playerId: 'player-2',
        roleId: 'drunk',
        apparentRole: 'chef',
      });
      expect(result.players[2].trueRole).toBe('drunk');
      expect(result.players[2].apparentRole).toBe('chef');
    });

    it('override returns same reference for invalid override (missing playerId)', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      const result = applyStorytellerOverride(state, { type: 'kill_player' } as StorytellerOverride);
      expect(result).toBe(state);
    });

    it('override returns same reference for invalid queuePosition', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      const result = applyStorytellerOverride(state, {
        type: 'modify_night_action',
        queuePosition: 999,
        storytellerInput: {},
      });
      expect(result).toBe(state);
    });

    it('override is pure: original state is not modified', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      const snapshot = JSON.stringify(state);

      applyStorytellerOverride(state, { type: 'kill_player', playerId: 'player-2' });
      expect(JSON.stringify(state)).toBe(snapshot);
    });

    it('override history is recorded in the game log', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      state = applyStorytellerOverride(state, { type: 'kill_player', playerId: 'player-2' });
      state = applyStorytellerOverride(state, { type: 'set_poison', playerId: 'player-3' });
      state = applyStorytellerOverride(state, { type: 'revive_player', playerId: 'player-2' });

      const overrideLogs = state.gameLog.filter((l) => l.type === 'storyteller_override');
      expect(overrideLogs).toHaveLength(3);
      expect((overrideLogs[0].data as { overrideType: string }).overrideType).toBe('kill_player');
      expect((overrideLogs[1].data as { overrideType: string }).overrideType).toBe('set_poison');
      expect((overrideLogs[2].data as { overrideType: string }).overrideType).toBe('revive_player');
    });

    it('storyteller override takes precedence over automated logic (can revive killed player)', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };

      // Automated kill
      state = addPendingDeath(state, 'player-2');
      // Storyteller overrides by removing pending death
      state = applyStorytellerOverride(state, { type: 'remove_pending_death', playerId: 'player-2' });
      expect(state.pendingDeaths).not.toContain('player-2');
    });

    it('night action overrides are reversible before End Night', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = { ...state, players: makePlayers(7) };
      state = transitionToNight(state);

      // Advance and override
      state = advanceNightQueue(state, { target: 'player-3' });
      state = applyStorytellerOverride(state, {
        type: 'modify_night_action',
        queuePosition: 0,
        storytellerInput: { target: 'player-5' },
      });
      expect(state.nightQueue[0].storytellerInput).toEqual({ target: 'player-5' });

      // Override again before commit
      state = applyStorytellerOverride(state, {
        type: 'modify_night_action',
        queuePosition: 0,
        storytellerInput: { target: 'player-6' },
      });
      expect(state.nightQueue[0].storytellerInput).toEqual({ target: 'player-6' });
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

    function setupGame(storytellerId: string): GameState {
      let state = createInitialGameState('g1', 'ABC123', storytellerId);
      state = { ...state, players: makePlayers(7) };
      state = transitionPhase(state, 'night');
      state = transitionToNight(state);
      store.games.set('g1', state);
      return state;
    }

    it('storyteller can apply override via WebSocket', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      const state = setupGame(st.id!);

      const overridePromise = waitForEvent(st, 'override_applied');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'kill_player', playerId: 'player-2' },
      });

      const result = await overridePromise as { overrideType: string; playerId: string };
      expect(result.overrideType).toBe('kill_player');
      expect(result.playerId).toBe('player-2');

      const updatedGame = store.games.get('g1')!;
      expect(updatedGame.players[2].isAlive).toBe(false);
    });

    it('non-storyteller cannot apply override', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      setupGame('other-st-id');

      const errorPromise = waitForEvent(st, 'override_error');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'kill_player', playerId: 'player-2' },
      });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Only the Storyteller can apply overrides');
    });

    it('override updates Grimoire sent to Storyteller', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      setupGame(st.id!);

      const grimoirePromise = waitForEvent(st, 'grimoire');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'set_poison', playerId: 'player-3' },
      });

      const grimoire = await grimoirePromise as { players: { playerId: string; isPoisoned: boolean }[] };
      const p3 = grimoire.players.find((p) => p.playerId === 'player-3');
      expect(p3?.isPoisoned).toBe(true);
    });

    it('override broadcasts sanitized game_state to all clients', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');

      // Join game via socket so the client is in the room
      let state = createInitialGameState('g1', 'ABC123', 'placeholder', 'SECRET');
      state = { ...state, players: makePlayers(7) };
      store.games.set('g1', state);

      // Collect all game_state events
      const stateEvents: unknown[] = [];
      st.on('game_state', (data: unknown) => stateEvents.push(data));

      st.emit('join_game', { joinCode: 'ABC123', playerName: 'Storyteller', hostSecret: 'SECRET' });
      await waitForEvent(st, 'game_joined');

      // Wait for join game_state to arrive
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const countAfterJoin = stateEvents.length;

      // Update the game to night phase with ST as storyteller
      let game = store.games.get('g1')!;
      game = { ...game, ...transitionToNight({ ...game, phase: 'night' as const }) };
      store.games.set('g1', game);

      const overridePromise = waitForEvent(st, 'override_applied');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'set_poison', playerId: 'player-2' },
      });
      await overridePromise;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      // Should have received at least one more game_state after the override
      expect(stateEvents.length).toBeGreaterThan(countAfterJoin);
      const lastState = stateEvents[stateEvents.length - 1] as GameState;
      // Sanitized: poison info should be hidden from players
      expect(lastState.players[2].isPoisoned).toBe(false);
    });

    it('cannot apply override in lobby phase', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      let state = createInitialGameState('g1', 'ABC123', st.id!);
      state = { ...state, players: makePlayers(7) };
      store.games.set('g1', state);

      const errorPromise = waitForEvent(st, 'override_error');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'kill_player', playerId: 'player-2' },
      });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Cannot apply overrides in current phase');
    });

    it('cannot apply override in ended phase', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      let state = createInitialGameState('g1', 'ABC123', st.id!);
      state = { ...state, players: makePlayers(7), phase: 'ended' as const };
      store.games.set('g1', state);

      const errorPromise = waitForEvent(st, 'override_error');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'kill_player', playerId: 'player-2' },
      });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Cannot apply overrides in current phase');
    });

    it('invalid override returns error', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      setupGame(st.id!);

      const errorPromise = waitForEvent(st, 'override_error');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'kill_player' }, // missing playerId
      });

      const error = await errorPromise as { message: string };
      expect(error.message).toBe('Invalid override');
    });

    it('override during day phase works', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      let state = createInitialGameState('g1', 'ABC123', st.id!);
      state = { ...state, players: makePlayers(7), phase: 'day' as const, daySubPhase: 'discussion' as const };
      store.games.set('g1', state);

      const overridePromise = waitForEvent(st, 'override_applied');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'set_poison', playerId: 'player-4' },
      });

      const result = await overridePromise as { overrideType: string };
      expect(result.overrideType).toBe('set_poison');
      expect(store.games.get('g1')!.players[4].isPoisoned).toBe(true);
    });

    it('override during setup phase works', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      let state = createInitialGameState('g1', 'ABC123', st.id!);
      state = { ...state, players: makePlayers(7), phase: 'setup' as const };
      store.games.set('g1', state);

      const overridePromise = waitForEvent(st, 'override_applied');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'set_player_role', playerId: 'player-2', roleId: 'imp' },
      });

      const result = await overridePromise as { overrideType: string };
      expect(result.overrideType).toBe('set_player_role');
      expect(store.games.get('g1')!.players[2].trueRole).toBe('imp');
    });

    it('override history is recorded in game log via WebSocket', async () => {
      const st = createClient();
      await waitForEvent(st, 'connect');
      setupGame(st.id!);

      // First override
      const p1 = waitForEvent(st, 'override_applied');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'kill_player', playerId: 'player-2' },
      });
      await p1;

      // Second override
      const p2 = waitForEvent(st, 'override_applied');
      st.emit('storyteller_override', {
        gameId: 'g1',
        override: { type: 'set_poison', playerId: 'player-3' },
      });
      await p2;

      const updatedGame = store.games.get('g1')!;
      const overrideLogs = updatedGame.gameLog.filter((l) => l.type === 'storyteller_override');
      expect(overrideLogs.length).toBe(2);
    });
  });
});
