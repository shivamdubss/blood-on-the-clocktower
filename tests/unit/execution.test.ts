import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addNomination,
  startVote,
  recordVote,
  resolveVote,
  resolveExecution,
  killPlayer,
  checkMayorWin,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, Player } from '../../src/types/game.js';

function makePlayers(count: number, overrides?: Partial<Player>[]): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    trueRole: 'washerwoman' as const,
    apparentRole: 'washerwoman' as const,
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex: i,
    ...(overrides?.[i] ?? {}),
  }));
}

describe('execution', () => {
  // --- State machine unit tests ---

  describe('state machine', () => {
    it('player with highest passing vote count is executed', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = { ...state, players: makePlayers(7), phase: 'day', daySubPhase: 'nomination' };

      // First nomination: 4 yes votes (passes, threshold = ceil(7/2) = 4)
      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p2', true);
      state = recordVote(state, 0, 'p3', true);
      state = recordVote(state, 0, 'p4', true);
      state = recordVote(state, 0, 'p5', true);
      state = resolveVote(state, 0);
      expect(state.nominations[0].passed).toBe(true);
      expect(state.nominations[0].voteCount).toBe(4);

      // Second nomination: 5 yes votes (higher, also passes)
      state = addNomination(state, 'p2', 'p3');
      state = startVote(state, 1);
      state = recordVote(state, 1, 'p0', true);
      state = recordVote(state, 1, 'p1', true);
      state = recordVote(state, 1, 'p4', true);
      state = recordVote(state, 1, 'p5', true);
      state = recordVote(state, 1, 'p6', true);
      state = resolveVote(state, 1);
      expect(state.nominations[1].passed).toBe(true);
      expect(state.nominations[1].voteCount).toBe(5);

      const result = resolveExecution(state);
      // p3 should be executed (nominee of second nomination with higher count)
      expect(result.executedPlayerId).toBe('p3');
      const executed = result.players.find((p) => p.id === 'p3')!;
      expect(executed.isAlive).toBe(false);
    });

    it('tie between two passing nominations results in no execution', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = { ...state, players: makePlayers(7), phase: 'day', daySubPhase: 'nomination' };

      // First nomination: 4 yes votes
      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      for (let i = 2; i < 6; i++) state = recordVote(state, 0, `p${i}`, true);
      state = resolveVote(state, 0);

      // Second nomination: also 4 yes votes (tie)
      state = addNomination(state, 'p2', 'p3');
      state = startVote(state, 1);
      for (let i of [0, 1, 4, 5]) state = recordVote(state, 1, `p${i}`, true);
      state = resolveVote(state, 1);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBeNull();
      const tieLog = result.gameLog.find((e) => e.type === 'execution_tie');
      expect(tieLog).toBeDefined();
    });

    it('executed player is marked as dead', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = { ...state, players: makePlayers(7), phase: 'day', daySubPhase: 'nomination' };

      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      for (let i = 2; i < 6; i++) state = recordVote(state, 0, `p${i}`, true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBe('p1');
      expect(result.players.find((p) => p.id === 'p1')!.isAlive).toBe(false);
      const deathLog = result.gameLog.find((e) => e.type === 'player_death');
      expect(deathLog).toBeDefined();
    });

    it('no execution when no nominations pass', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = { ...state, players: makePlayers(7), phase: 'day', daySubPhase: 'nomination' };

      // Nomination with only 3 votes (below threshold of 4)
      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p2', true);
      state = recordVote(state, 0, 'p3', true);
      state = recordVote(state, 0, 'p4', true);
      state = resolveVote(state, 0);
      expect(state.nominations[0].passed).toBe(false);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBeNull();
      const noExecLog = result.gameLog.find((e) => e.type === 'no_execution');
      expect(noExecLog).toBeDefined();
      // All players still alive
      expect(result.players.every((p) => p.isAlive)).toBe(true);
    });

    it('no execution when there are no nominations at all', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = { ...state, players: makePlayers(7), phase: 'day', daySubPhase: 'nomination' };

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBeNull();
    });

    it('Saint execution triggers Evil win', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(7);
      players[1].trueRole = 'saint';
      state = { ...state, players, phase: 'day', daySubPhase: 'nomination' };

      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      for (let i = 2; i < 6; i++) state = recordVote(state, 0, `p${i}`, true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.winner).toBe('evil');
      expect(result.phase).toBe('ended');
      expect(result.executedPlayerId).toBe('p1');
    });

    it('poisoned Saint execution does not trigger Evil win', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(7);
      players[1].trueRole = 'saint';
      players[1].isPoisoned = true;
      players[6].trueRole = 'imp'; // Need a living demon so checkWinConditions doesn't trigger Good win
      state = { ...state, players, phase: 'day', daySubPhase: 'nomination' };

      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      for (let i = 2; i < 6; i++) state = recordVote(state, 0, `p${i}`, true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBe('p1');
      expect(result.winner).toBeNull();
      expect(result.phase).not.toBe('ended');
    });

    it('Demon execution triggers Good win', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(7);
      players[1].trueRole = 'imp';
      state = { ...state, players, phase: 'day', daySubPhase: 'nomination' };

      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      for (let i = 2; i < 6; i++) state = recordVote(state, 0, `p${i}`, true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.winner).toBe('good');
      expect(result.phase).toBe('ended');
    });

    it('Demon execution with Scarlet Woman trigger: SW becomes Imp, game continues', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(7);
      players[1].trueRole = 'imp';
      players[2].trueRole = 'scarletWoman';
      state = { ...state, players, phase: 'day', daySubPhase: 'nomination' };

      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      for (let i = 3; i < 7; i++) state = recordVote(state, 0, `p${i}`, true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      // Game should continue -- SW becomes Imp
      expect(result.winner).toBeNull();
      expect(result.phase).not.toBe('ended');
      expect(result.players.find((p) => p.id === 'p2')!.trueRole).toBe('imp');
      const swLog = result.gameLog.find((e) => e.type === 'scarlet_woman_trigger');
      expect(swLog).toBeDefined();
    });

    it('Demon execution with poisoned Scarlet Woman: Good wins', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(7);
      players[1].trueRole = 'imp';
      players[2].trueRole = 'scarletWoman';
      players[2].isPoisoned = true;
      state = { ...state, players, phase: 'day', daySubPhase: 'nomination' };

      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      for (let i = 3; i < 7; i++) state = recordVote(state, 0, `p${i}`, true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.winner).toBe('good');
      expect(result.phase).toBe('ended');
    });

    it('Demon execution with Scarlet Woman but fewer than 5 alive: Good wins', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(5);
      players[1].trueRole = 'imp';
      players[2].trueRole = 'scarletWoman';
      // Kill 2 players so only 3 alive before execution
      players[3].isAlive = false;
      players[4].isAlive = false;
      state = { ...state, players, phase: 'day', daySubPhase: 'nomination' };

      // threshold = ceil(3/2) = 2
      state = addNomination(state, 'p0', 'p1');
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p0', true);
      state = recordVote(state, 0, 'p2', true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      // Only 3 alive, SW trigger requires 5+, so Good wins
      expect(result.winner).toBe('good');
      expect(result.phase).toBe('ended');
    });

    it('execution with 2 players remaining triggers Evil win check', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(5);
      players[4].trueRole = 'imp';
      // Kill 2 players, leaving 3 alive
      players[2].isAlive = false;
      players[3].isAlive = false;
      state = { ...state, players, phase: 'day', daySubPhase: 'nomination' };

      // Execute p0 (not the Demon), leaving 2 alive (p1 and p4 the Imp)
      state = addNomination(state, 'p1', 'p0');
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p1', true);
      state = recordVote(state, 0, 'p4', true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBe('p0');
      // With p0 dead, only p1 and p4 (Imp) alive → Evil wins
      expect(result.winner).toBe('evil');
      expect(result.phase).toBe('ended');
    });
  });

  // --- Mayor win condition tests ---

  describe('Mayor win condition', () => {
    it('Mayor win: 3 players alive, no execution, Mayor alive → Good wins', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(5);
      players[0].trueRole = 'mayor';
      players[3].isAlive = false;
      players[4].isAlive = false;
      state = { ...state, players, phase: 'day', daySubPhase: 'end', executedPlayerId: null };

      const result = checkMayorWin(state);
      expect(result.winner).toBe('good');
      expect(result.phase).toBe('ended');
    });

    it('Mayor win: Mayor is poisoned → no win', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(5);
      players[0].trueRole = 'mayor';
      players[0].isPoisoned = true;
      players[3].isAlive = false;
      players[4].isAlive = false;
      state = { ...state, players, phase: 'day', daySubPhase: 'end', executedPlayerId: null };

      const result = checkMayorWin(state);
      expect(result.winner).toBeNull();
      expect(result.phase).toBe('day');
    });

    it('Mayor win: execution occurred → no win', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(5);
      players[0].trueRole = 'mayor';
      players[3].isAlive = false;
      players[4].isAlive = false;
      state = { ...state, players, phase: 'day', daySubPhase: 'execution', executedPlayerId: 'p3' };

      const result = checkMayorWin(state);
      expect(result.winner).toBeNull();
      expect(result.phase).toBe('day');
    });

    it('Mayor win: 4 players alive → no win', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(5);
      players[0].trueRole = 'mayor';
      players[4].isAlive = false;
      state = { ...state, players, phase: 'day', daySubPhase: 'end', executedPlayerId: null };

      const result = checkMayorWin(state);
      expect(result.winner).toBeNull();
      expect(result.phase).toBe('day');
    });

    it('Mayor win: no Mayor alive → no win', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      const players = makePlayers(5);
      // All players are washerwoman (default), no mayor
      players[3].isAlive = false;
      players[4].isAlive = false;
      state = { ...state, players, phase: 'day', daySubPhase: 'end', executedPlayerId: null };

      const result = checkMayorWin(state);
      expect(result.winner).toBeNull();
      expect(result.phase).toBe('day');
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

    async function setupGameInNomination(count: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
      const host = createClient();
      await waitForEvent(host, 'connect');

      const game = createInitialGameState('game-1', 'ABC123', host.id!);
      store.games.set(game.id, game);

      host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
      await waitForEvent(host, 'game_joined');
      await new Promise<void>((r) => setTimeout(r, 50));

      const players: ClientSocket[] = [];
      for (let i = 0; i < count - 1; i++) {
        const p = createClient();
        await waitForEvent(p, 'connect');
        p.emit('join_game', { joinCode: 'ABC123', playerName: `Player${i}` });
        await waitForEvent(p, 'game_joined');
        players.push(p);
      }
      await new Promise<void>((r) => setTimeout(r, 50));

      // Start game
      host.emit('start_game', { gameId: 'game-1' });
      await waitForEvent(host, 'game_started');
      await new Promise<void>((r) => setTimeout(r, 50));

      // Transition to day
      const currentGame = store.games.get('game-1')!;
      store.games.set('game-1', { ...currentGame, phase: 'night' });

      host.emit('transition_to_day', { gameId: 'game-1' });
      await waitForEvent(host, 'dawn_announcement');
      await new Promise<void>((r) => setTimeout(r, 50));

      // Start discussion
      host.emit('start_discussion', { gameId: 'game-1' });
      await waitForEvent(host, 'discussion_started');
      await new Promise<void>((r) => setTimeout(r, 50));

      // End discussion -> nomination phase
      host.emit('end_discussion', { gameId: 'game-1' });
      await waitForEvent(host, 'discussion_ended');
      await new Promise<void>((r) => setTimeout(r, 50));

      return { host, players, gameId: 'game-1' };
    }

    async function nominateAndVote(
      host: ClientSocket,
      nominator: ClientSocket,
      nomineeId: string,
      voters: ClientSocket[],
      gameId: string,
    ): Promise<void> {
      const voteStartedPromise = waitForEvent(host, 'vote_started');
      nominator.emit('nominate', { gameId, nomineeId });
      await voteStartedPromise;
      await new Promise<void>((r) => setTimeout(r, 50));

      for (const voter of voters) {
        voter.emit('submit_vote', { gameId, vote: true });
        await waitForEvent(voter, 'vote_recorded');
      }
      await new Promise<void>((r) => setTimeout(r, 50));

      // Storyteller reveals votes
      const voteResultPromise = waitForEvent(host, 'vote_result');
      host.emit('reveal_votes', { gameId });
      await voteResultPromise;
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    it('Storyteller can resolve execution and player with highest passing votes is executed', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      // Nominate and vote: players[1] nominated with 4 yes votes (passes, threshold=4)
      await nominateAndVote(host, players[0], players[1].id!, [players[2], players[3], players[4], players[5]], gameId);

      // Resolve execution
      const execResultPromise = waitForEvent(host, 'execution_result');
      host.emit('resolve_execution', { gameId });
      const result = (await execResultPromise) as { executed: { playerId: string; playerName: string } | null; reason: string };

      expect(result.executed).not.toBeNull();
      expect(result.executed!.playerId).toBe(players[1].id!);
      expect(result.reason).toBe('executed');

      // Verify player is dead in state
      const game = store.games.get(gameId)!;
      const executedPlayer = game.players.find((p) => p.id === players[1].id!)!;
      expect(executedPlayer.isAlive).toBe(false);
    });

    it('no execution when no nominations pass', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      // Nominate with only 3 votes (below threshold of 4)
      await nominateAndVote(host, players[0], players[1].id!, [players[2], players[3], players[4]], gameId);

      const execResultPromise = waitForEvent(host, 'execution_result');
      host.emit('resolve_execution', { gameId });
      const result = (await execResultPromise) as { executed: null; reason: string };

      expect(result.executed).toBeNull();
      expect(result.reason).toBe('no_passing_nominations');
    });

    it('tie results in no execution', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      // First nomination: 4 yes votes on players[1]
      await nominateAndVote(host, players[0], players[1].id!, [players[2], players[3], players[4], players[5]], gameId);

      // Second nomination: 4 yes votes on players[3]
      await nominateAndVote(host, players[2], players[3].id!, [players[0], players[1], players[4], players[5]], gameId);

      const execResultPromise = waitForEvent(host, 'execution_result');
      host.emit('resolve_execution', { gameId });
      const result = (await execResultPromise) as { executed: null; reason: string };

      expect(result.executed).toBeNull();
      expect(result.reason).toBe('tie');
    });

    it('all clients receive execution_result simultaneously', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      await nominateAndVote(host, players[0], players[1].id!, [players[2], players[3], players[4], players[5]], gameId);

      const resultPromises = [host, ...players].map((c) => waitForEvent(c, 'execution_result'));
      host.emit('resolve_execution', { gameId });
      const results = await Promise.all(resultPromises);

      for (const result of results) {
        const r = result as { executed: { playerId: string } | null; reason: string };
        expect(r.executed).not.toBeNull();
        expect(r.reason).toBe('executed');
      }
    });

    it('only the Storyteller can resolve execution', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      const errorPromise = waitForEvent(players[0], 'execution_error');
      players[0].emit('resolve_execution', { gameId });
      const error = (await errorPromise) as { message: string };
      expect(error.message).toBe('Only the Storyteller can resolve execution');
    });

    it('Demon execution triggers game_over event with Good win', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      // Set one player as the Imp
      const game = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) =>
          p.id === players[1].id! ? { ...p, trueRole: 'imp' as const } : p
        ),
      });

      await nominateAndVote(host, players[0], players[1].id!, [players[2], players[3], players[4], players[5]], gameId);

      const gameOverPromise = waitForEvent(host, 'game_over');
      host.emit('resolve_execution', { gameId });
      const gameOver = (await gameOverPromise) as { winner: string; players: { trueRole: string }[] };

      expect(gameOver.winner).toBe('good');
      expect(gameOver.players.length).toBeGreaterThan(0);
    });

    it('Saint execution triggers game_over event with Evil win', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      // Set one player as the Saint
      const game = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) =>
          p.id === players[1].id! ? { ...p, trueRole: 'saint' as const } : p
        ),
      });

      await nominateAndVote(host, players[0], players[1].id!, [players[2], players[3], players[4], players[5]], gameId);

      const gameOverPromise = waitForEvent(host, 'game_over');
      host.emit('resolve_execution', { gameId });
      const gameOver = (await gameOverPromise) as { winner: string };

      expect(gameOver.winner).toBe('evil');
    });

    it('end_day with Mayor win condition triggers game_over with Good win', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      // Set up game state: 3 alive players, one is Mayor, no execution
      const game = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p, i) => ({
          ...p,
          trueRole: i === 0 ? ('mayor' as const) : p.trueRole,
          isAlive: i < 3, // only first 3 players alive
        })),
        executedPlayerId: null,
        daySubPhase: 'end' as const,
      });

      // Close nominations so end_day is allowed
      host.emit('close_nominations', { gameId });
      await new Promise<void>((r) => setTimeout(r, 50));

      const gameOverPromise = waitForEvent(host, 'game_over');
      host.emit('end_day', { gameId });
      const gameOver = (await gameOverPromise) as { winner: string; players: { trueRole: string }[] };

      expect(gameOver.winner).toBe('good');
      expect(gameOver.players.length).toBeGreaterThan(0);
    });
  });
});
