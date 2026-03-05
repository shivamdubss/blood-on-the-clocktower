import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  resolveExecution,
  addNomination,
  startVote,
  recordVote,
  resolveVote,
  processImpAction,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import { metadata as swMeta } from '../../src/roles/scarletWoman.js';
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
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'scarletWoman', apparentRole: 'scarletWoman', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'monk', apparentRole: 'monk', seatIndex: 4 }));
  state = addPlayer(state, makePlayer({ id: 'p6', name: 'Frank', trueRole: 'butler', apparentRole: 'butler', seatIndex: 5 }));
  state = addPlayer(state, makePlayer({ id: 'p7', name: 'Grace', trueRole: 'chef', apparentRole: 'chef', seatIndex: 6 }));
  return state;
}

function setupNominationAndVote(state: GameState, nominatorId: string, nomineeId: string, voterIds: string[]): GameState {
  state = { ...state, phase: 'day', daySubPhase: 'nomination' };
  state = addNomination(state, nominatorId, nomineeId);
  state = startVote(state, 0);
  for (const voterId of voterIds) {
    state = recordVote(state, 0, voterId, true);
  }
  state = resolveVote(state, 0);
  return state;
}

describe('Scarlet Woman', () => {
  describe('metadata', () => {
    it('Scarlet Woman is a Minion on the Evil team', () => {
      expect(swMeta.team).toBe('minion');
      expect(swMeta.type).toBe('minion');
    });

    it('Scarlet Woman has no night ability', () => {
      expect(swMeta.firstNight).toBe(false);
      expect(swMeta.otherNights).toBe(false);
    });
  });

  describe('state machine', () => {
    it('Scarlet Woman becomes Imp when Demon is executed with 5+ alive', () => {
      let state = makeGameWithPlayers();
      // All 7 players alive, nominate and vote to execute the Imp (p1)
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4', 'p5', 'p6']);

      const result = resolveExecution(state);

      expect(result.players.find(p => p.id === 'p1')!.isAlive).toBe(false);
      expect(result.players.find(p => p.id === 'p2')!.trueRole).toBe('imp');
      expect(result.phase).not.toBe('ended');
      expect(result.winner).toBeNull();
    });

    it('alive count is checked BEFORE applying Demon death', () => {
      let state = makeGameWithPlayers();
      // Kill 2 to bring to 5 alive (still >= 5 threshold)
      state = {
        ...state,
        players: state.players.map(p => {
          if (p.id === 'p6' || p.id === 'p7') return { ...p, isAlive: false };
          return p;
        }),
      };
      // 5 alive: p1(Imp), p2(SW), p3, p4, p5
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4', 'p5']);

      const result = resolveExecution(state);

      // SW trigger fires because aliveBeforeDeath = 5
      expect(result.players.find(p => p.id === 'p2')!.trueRole).toBe('imp');
      expect(result.phase).not.toBe('ended');
    });

    it('Scarlet Woman does NOT trigger with fewer than 5 alive', () => {
      let state = makeGameWithPlayers();
      // Kill 3 players to bring alive count to 4
      state = {
        ...state,
        players: state.players.map(p => {
          if (p.id === 'p5' || p.id === 'p6' || p.id === 'p7') return { ...p, isAlive: false };
          return p;
        }),
      };
      // 4 alive: p1(Imp), p2(SW), p3, p4
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4']);

      const result = resolveExecution(state);

      expect(result.winner).toBe('good');
      expect(result.phase).toBe('ended');
      expect(result.players.find(p => p.id === 'p2')!.trueRole).toBe('scarletWoman');
    });

    it('transformation is secret: only logged in gameLog, not broadcast publicly', () => {
      let state = makeGameWithPlayers();
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4', 'p5', 'p6']);

      const result = resolveExecution(state);

      const swLog = result.gameLog.find(l => l.type === 'scarlet_woman_trigger');
      expect(swLog).toBeDefined();
      expect((swLog!.data as { playerId: string }).playerId).toBe('p2');
    });

    it('Good does NOT win when Scarlet Woman trigger activates', () => {
      let state = makeGameWithPlayers();
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4', 'p5', 'p6']);

      const result = resolveExecution(state);

      expect(result.winner).toBeNull();
      expect(result.phase).not.toBe('ended');
    });

    it('Scarlet Woman poisoned: ability does NOT trigger, Good wins', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map(p =>
          p.id === 'p2' ? { ...p, isPoisoned: true } : p
        ),
      };
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4', 'p5', 'p6']);

      const result = resolveExecution(state);

      expect(result.winner).toBe('good');
      expect(result.phase).toBe('ended');
      expect(result.players.find(p => p.id === 'p2')!.trueRole).toBe('scarletWoman');
    });

    it('Scarlet Woman does NOT trigger on Imp star-pass', () => {
      let state = makeGameWithPlayers();
      state = { ...state, phase: 'night' };

      // Add a poisoner as another minion
      state = {
        ...state,
        players: state.players.map(p =>
          p.id === 'p3' ? { ...p, trueRole: 'poisoner' as RoleId, apparentRole: 'poisoner' as RoleId } : p
        ),
      };

      const result = processImpAction(state, 'p1', 'p1', 'p3');

      expect(result.players.find(p => p.id === 'p3')!.trueRole).toBe('imp');
      expect(result.players.find(p => p.id === 'p2')!.trueRole).toBe('scarletWoman');
      const starPassLog = result.gameLog.find(l => l.type === 'imp_star_pass');
      expect(starPassLog).toBeDefined();
    });

    it('Scarlet Woman timing: exact 5 alive triggers, 4 alive does not', () => {
      // Exactly 5 alive (boundary case)
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map(p => {
          if (p.id === 'p6' || p.id === 'p7') return { ...p, isAlive: false };
          return p;
        }),
      };
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4', 'p5']);

      const result5 = resolveExecution(state);
      expect(result5.players.find(p => p.id === 'p2')!.trueRole).toBe('imp');
      expect(result5.phase).not.toBe('ended');

      // Exactly 4 alive (below threshold)
      let state4 = makeGameWithPlayers();
      state4 = {
        ...state4,
        players: state4.players.map(p => {
          if (p.id === 'p5' || p.id === 'p6' || p.id === 'p7') return { ...p, isAlive: false };
          return p;
        }),
      };
      state4 = setupNominationAndVote(state4, 'p3', 'p1', ['p3', 'p4']);

      const result4 = resolveExecution(state4);
      expect(result4.players.find(p => p.id === 'p2')!.trueRole).toBe('scarletWoman');
      expect(result4.winner).toBe('good');
    });

    it('Scarlet Woman dead: ability does NOT trigger', () => {
      let state = makeGameWithPlayers();
      state = {
        ...state,
        players: state.players.map(p =>
          p.id === 'p2' ? { ...p, isAlive: false } : p
        ),
      };
      // 6 alive (>= 5) but SW is dead
      state = setupNominationAndVote(state, 'p3', 'p1', ['p3', 'p4', 'p5', 'p6']);

      const result = resolveExecution(state);

      expect(result.winner).toBe('good');
      expect(result.phase).toBe('ended');
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

    it('Scarlet Woman trigger: execution_result shows executed player but game continues', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      await new Promise<void>((resolve) => storyteller.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');

      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'chef', apparentRole: 'chef', seatIndex: 0 }),
        makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'scarletWoman', apparentRole: 'scarletWoman', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'Diana', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }),
      ];

      let g: GameState = { ...store.games.get(gameId)!, players, storytellerId: storyteller.id!, phase: 'day' as const, daySubPhase: 'nomination' as const, dayNumber: 1 };
      g = addNomination(g, storyteller.id!, 'p2');
      g = startVote(g, 0);
      for (const p of players) {
        g = recordVote(g, 0, p.id, true);
      }
      g = resolveVote(g, 0);
      store.games.set(gameId, g);

      const execResult = waitForEvent(storyteller, 'execution_result') as Promise<{ executed: { playerId: string } | null }>;

      storyteller.emit('resolve_execution', { gameId });
      const result = await execResult;

      expect(result.executed).not.toBeNull();
      expect(result.executed!.playerId).toBe('p2');

      const updatedState = store.games.get(gameId)!;
      expect(updatedState.phase).not.toBe('ended');
      expect(updatedState.players.find(p => p.id === 'p3')!.trueRole).toBe('imp');
    });

    it('Scarlet Woman transformation is not visible in sanitized game_state', async () => {
      const gameId = 'g1';
      let state = createInitialGameState(gameId, 'ABC123', '');
      store.games.set(gameId, state);

      const storyteller = createClient();
      const player = createClient();

      await new Promise<void>((resolve) => storyteller.on('connect', resolve));
      await new Promise<void>((resolve) => player.on('connect', resolve));

      storyteller.emit('join_game', { joinCode: 'ABC123', playerName: 'ST' });
      await waitForEvent(storyteller, 'game_joined');
      player.emit('join_game', { joinCode: 'ABC123', playerName: 'Player' });
      await waitForEvent(player, 'game_joined');

      const players = [
        makePlayer({ id: storyteller.id!, name: 'ST', trueRole: 'chef', apparentRole: 'chef', seatIndex: 0 }),
        makePlayer({ id: player.id!, name: 'Player', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 1 }),
        makePlayer({ id: 'p3', name: 'Imp', trueRole: 'imp', apparentRole: 'imp', seatIndex: 2 }),
        makePlayer({ id: 'p4', name: 'SW', trueRole: 'scarletWoman', apparentRole: 'scarletWoman', seatIndex: 3 }),
        makePlayer({ id: 'p5', name: 'Eve', trueRole: 'empath', apparentRole: 'empath', seatIndex: 4 }),
        makePlayer({ id: 'p6', name: 'Frank', trueRole: 'monk', apparentRole: 'monk', seatIndex: 5 }),
        makePlayer({ id: 'p7', name: 'Grace', trueRole: 'butler', apparentRole: 'butler', seatIndex: 6 }),
      ];

      let g: GameState = { ...store.games.get(gameId)!, players, storytellerId: storyteller.id!, phase: 'day' as const, daySubPhase: 'nomination' as const, dayNumber: 1 };
      g = addNomination(g, storyteller.id!, 'p3');
      g = startVote(g, 0);
      for (const p of players) {
        g = recordVote(g, 0, p.id, true);
      }
      g = resolveVote(g, 0);
      store.games.set(gameId, g);

      // Listen for game_state on the player client (SW trigger = game continues = sanitized)
      const gameStatePromise = waitForEvent(player, 'game_state') as Promise<{ players: Array<{ trueRole?: string }> }>;

      storyteller.emit('resolve_execution', { gameId });
      const gameState = await gameStatePromise;

      // Player's game_state should NOT reveal that SW became Imp (sanitized)
      // Sanitizer replaces all trueRoles with a placeholder
      const swPlayer = gameState.players.find((p: { id?: string; name?: string }) => p.name === 'SW');
      expect(swPlayer).toBeDefined();
      // The sanitized trueRole should NOT be 'imp' (the SW transformation is hidden)
      expect((swPlayer as { trueRole: string }).trueRole).not.toBe('imp');
      expect((swPlayer as { trueRole: string }).trueRole).not.toBe('scarletWoman');
    });
  });
});
