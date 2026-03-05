import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  processVirginNomination,
  killPlayer,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, RoleId } from '../../src/types/game.js';

function makePlayer(id: string, name: string, trueRole: RoleId, apparentRole?: RoleId, overrides?: Partial<GameState['players'][0]>) {
  return {
    id,
    name,
    trueRole,
    apparentRole: apparentRole ?? trueRole,
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex: 0,
    ...overrides,
  };
}

describe('Virgin', () => {
  // --- State machine unit tests ---

  describe('processVirginNomination', () => {
    it('triggers when Virgin is nominated by a Townsfolk and executes the nominator', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'washerwoman', 'washerwoman', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'imp', 'imp', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(true);
      expect(result.nominatorExecuted).toBe(true);
      expect(result.state.virginAbilityUsed).toBe(true);

      const nominator = result.state.players.find((p) => p.id === 'p1')!;
      expect(nominator.isAlive).toBe(false);
      expect(result.state.executedPlayerId).toBe('p1');
    });

    it('marks ability as spent on first nomination regardless of outcome', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'imp', 'imp', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
        ],
      };

      // Imp nominates Virgin — Imp is not a Townsfolk, so no execution
      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(true);
      expect(result.nominatorExecuted).toBe(false);
      expect(result.state.virginAbilityUsed).toBe(true);
    });

    it('does not trigger if ability has already been used', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        virginAbilityUsed: true,
        players: [
          makePlayer('p1', 'Alice', 'washerwoman', 'washerwoman', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(false);
      expect(result.nominatorExecuted).toBe(false);
      expect(result.state.virginAbilityUsed).toBe(true);
    });

    it('does not trigger if nominee is not the Virgin', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'washerwoman', 'washerwoman', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'chef', 'chef', { seatIndex: 1 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(false);
      expect(result.nominatorExecuted).toBe(false);
      expect(result.state.virginAbilityUsed).toBe(false);
    });

    it('does not execute nominator if Virgin is poisoned', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'washerwoman', 'washerwoman', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1, isPoisoned: true }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(true);
      expect(result.nominatorExecuted).toBe(false);
      expect(result.state.virginAbilityUsed).toBe(true);
      // Nominator stays alive
      const nominator = result.state.players.find((p) => p.id === 'p1')!;
      expect(nominator.isAlive).toBe(true);
    });

    it('Drunk nominator counts as Townsfolk (uses apparent role)', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'drunk', 'washerwoman', { seatIndex: 0, isDrunk: true }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'imp', 'imp', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(true);
      expect(result.nominatorExecuted).toBe(true);
      // Drunk is executed
      const drunk = result.state.players.find((p) => p.id === 'p1')!;
      expect(drunk.isAlive).toBe(false);
    });

    it('Minion nominator does not trigger execution', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'poisoner', 'poisoner', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(true);
      expect(result.nominatorExecuted).toBe(false);
      expect(result.state.virginAbilityUsed).toBe(true);
    });

    it('Outsider nominator does not trigger execution', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'recluse', 'recluse', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(true);
      expect(result.nominatorExecuted).toBe(false);
    });

    it('Demon nominator does not trigger execution', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'imp', 'imp', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      expect(result.triggered).toBe(true);
      expect(result.nominatorExecuted).toBe(false);
    });

    it('logs virgin_nominated and virgin_execution events', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'washerwoman', 'washerwoman', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'imp', 'imp', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processVirginNomination(state, 'p1', 'p2');
      const logs = result.state.gameLog;
      expect(logs.some((l) => l.type === 'virgin_nominated')).toBe(true);
      expect(logs.some((l) => l.type === 'virgin_execution')).toBe(true);
    });

    it('is pure and does not mutate original state', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer('p1', 'Alice', 'washerwoman', 'washerwoman', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'virgin', 'virgin', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'imp', 'imp', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const originalUsed = state.virginAbilityUsed;
      processVirginNomination(state, 'p1', 'p2');
      expect(state.virginAbilityUsed).toBe(originalUsed);
    });
  });

  // --- WebSocket integration tests ---

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

    async function setupGameInNomination(playerCount: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
      const host = createClient();
      await waitForEvent(host, 'connect');

      const game = createInitialGameState('game-1', 'ABC123', host.id!);
      store.games.set(game.id, game);

      host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
      await waitForEvent(host, 'game_joined');
      await new Promise<void>((r) => setTimeout(r, 50));

      const players: ClientSocket[] = [];
      for (let i = 0; i < playerCount - 1; i++) {
        const p = createClient();
        await waitForEvent(p, 'connect');
        p.emit('join_game', { joinCode: 'ABC123', playerName: `Player${i}` });
        await waitForEvent(p, 'game_joined');
        players.push(p);
      }
      await new Promise<void>((r) => setTimeout(r, 50));

      host.emit('start_game', { gameId: 'game-1' });
      await waitForEvent(host, 'game_started');
      await new Promise<void>((r) => setTimeout(r, 50));

      // Transition to day/nomination
      const currentGame = store.games.get('game-1')!;
      store.games.set('game-1', { ...currentGame, phase: 'night' });

      host.emit('transition_to_day', { gameId: 'game-1' });
      await waitForEvent(host, 'dawn_announcement');
      await new Promise<void>((r) => setTimeout(r, 50));

      host.emit('start_discussion', { gameId: 'game-1' });
      await waitForEvent(host, 'discussion_started');
      await new Promise<void>((r) => setTimeout(r, 50));

      host.emit('end_discussion', { gameId: 'game-1' });
      await waitForEvent(host, 'discussion_ended');
      await new Promise<void>((r) => setTimeout(r, 50));

      return { host, players, gameId: 'game-1' };
    }

    it('Townsfolk nominating Virgin triggers virgin_triggered and execution_result events', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);
      const game = store.games.get(gameId)!;

      // Make player0 a Townsfolk and player1 the Virgin
      const nominatorId = players[0].id!;
      const virginId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === nominatorId) return { ...p, trueRole: 'washerwoman' as const, apparentRole: 'washerwoman' as const };
          if (p.id === virginId) return { ...p, trueRole: 'virgin' as const, apparentRole: 'virgin' as const };
          return p;
        }),
      });

      const virginPromise = waitForEvent(host, 'virgin_triggered');
      const executionPromise = waitForEvent(host, 'execution_result');
      players[0].emit('nominate', { gameId, nomineeId: virginId });

      const virginData = await virginPromise as { virginId: string; executedId: string; executedName: string };
      expect(virginData.virginId).toBe(virginId);
      expect(virginData.executedId).toBe(nominatorId);

      const executionData = await executionPromise as { executed: { playerId: string }; reason: string };
      expect(executionData.executed.playerId).toBe(nominatorId);
      expect(executionData.reason).toBe('virgin');
    });

    it('non-Townsfolk nominating Virgin does not trigger execution, vote starts normally', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);
      const game = store.games.get(gameId)!;

      // Make player0 a Minion and player1 the Virgin
      const nominatorId = players[0].id!;
      const virginId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === nominatorId) return { ...p, trueRole: 'poisoner' as const, apparentRole: 'poisoner' as const };
          if (p.id === virginId) return { ...p, trueRole: 'virgin' as const, apparentRole: 'virgin' as const };
          return p;
        }),
      });

      const votePromise = waitForEvent(host, 'vote_started');
      players[0].emit('nominate', { gameId, nomineeId: virginId });

      const voteData = await votePromise as { nomineeId: string };
      expect(voteData.nomineeId).toBe(virginId);

      // Virgin ability should be used
      const updatedGame = store.games.get(gameId)!;
      expect(updatedGame.virginAbilityUsed).toBe(true);
    });

    it('poisoned Virgin does not trigger execution, vote starts normally', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);
      const game = store.games.get(gameId)!;

      const nominatorId = players[0].id!;
      const virginId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === nominatorId) return { ...p, trueRole: 'washerwoman' as const, apparentRole: 'washerwoman' as const };
          if (p.id === virginId) return { ...p, trueRole: 'virgin' as const, apparentRole: 'virgin' as const, isPoisoned: true };
          return p;
        }),
      });

      const votePromise = waitForEvent(host, 'vote_started');
      players[0].emit('nominate', { gameId, nomineeId: virginId });

      const voteData = await votePromise as { nomineeId: string };
      expect(voteData.nomineeId).toBe(virginId);

      const updatedGame = store.games.get(gameId)!;
      expect(updatedGame.virginAbilityUsed).toBe(true);
      // Nominator is still alive
      const nominator = updatedGame.players.find((p) => p.id === nominatorId)!;
      expect(nominator.isAlive).toBe(true);
    });

    it('Drunk nominating Virgin triggers execution (Drunk apparent role is Townsfolk)', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);
      const game = store.games.get(gameId)!;

      const drunkId = players[0].id!;
      const virginId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === drunkId) return { ...p, trueRole: 'drunk' as const, apparentRole: 'washerwoman' as const, isDrunk: true };
          if (p.id === virginId) return { ...p, trueRole: 'virgin' as const, apparentRole: 'virgin' as const };
          return p;
        }),
      });

      const virginPromise = waitForEvent(host, 'virgin_triggered');
      const executionPromise = waitForEvent(host, 'execution_result');
      players[0].emit('nominate', { gameId, nomineeId: virginId });

      const virginData = await virginPromise as { executedId: string };
      expect(virginData.executedId).toBe(drunkId);

      const executionData = await executionPromise as { executed: { playerId: string }; reason: string };
      expect(executionData.executed.playerId).toBe(drunkId);
      expect(executionData.reason).toBe('virgin');

      // Drunk is dead
      const updatedGame = store.games.get(gameId)!;
      const drunk = updatedGame.players.find((p) => p.id === drunkId)!;
      expect(drunk.isAlive).toBe(false);
    });

    it('second nomination of Virgin does not trigger ability (already spent)', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);
      const game = store.games.get(gameId)!;

      const nominatorId = players[0].id!;
      const nominator2Id = players[2].id!;
      const virginId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        virginAbilityUsed: true,
        players: game.players.map((p) => {
          if (p.id === nominator2Id) return { ...p, trueRole: 'washerwoman' as const, apparentRole: 'washerwoman' as const };
          if (p.id === virginId) return { ...p, trueRole: 'virgin' as const, apparentRole: 'virgin' as const };
          return p;
        }),
      });

      // Need to set up so nominator2 can nominate the Virgin
      // Clear nominations to allow fresh nomination
      const currentGame = store.games.get(gameId)!;
      store.games.set(gameId, { ...currentGame, nominations: [] });

      const votePromise = waitForEvent(host, 'vote_started');
      players[2].emit('nominate', { gameId, nomineeId: virginId });

      const voteData = await votePromise as { nomineeId: string };
      expect(voteData.nomineeId).toBe(virginId);

      // Nominator2 is still alive (ability already spent)
      const updatedGame = store.games.get(gameId)!;
      const nominator2 = updatedGame.players.find((p) => p.id === nominator2Id)!;
      expect(nominator2.isAlive).toBe(true);
    });
  });
});
