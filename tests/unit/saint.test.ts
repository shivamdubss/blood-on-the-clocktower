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
  resolveDawnDeaths,
  addPendingDeath,
  processVirginNomination,
  poisonPlayer,
} from '../../src/server/gameStateMachine.js';
import { metadata as saintMetadata } from '../../src/roles/saint.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, RoleId, Player } from '../../src/types/game.js';

function makePlayer(overrides: Partial<Player> & { id: string; name: string; trueRole: RoleId }): Player {
  return {
    apparentRole: overrides.trueRole,
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex: 0,
    ...overrides,
  };
}

describe('Saint', () => {
  describe('metadata', () => {
    it('Saint is an Outsider on the outsider team', () => {
      expect(saintMetadata.team).toBe('outsider');
      expect(saintMetadata.type).toBe('outsider');
    });

    it('Saint is a passive role with no night action', () => {
      expect(saintMetadata.firstNight).toBe(false);
      expect(saintMetadata.otherNights).toBe(false);
    });

    it('Saint ability text matches expected', () => {
      expect(saintMetadata.ability).toContain('execution');
      expect(saintMetadata.ability).toContain('loses');
    });
  });

  describe('state machine', () => {
    let state: GameState;

    beforeEach(() => {
      state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'nomination',
        players: [
          makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', seatIndex: 0 }),
          makePlayer({ id: 'p2', name: 'Bob', trueRole: 'saint', seatIndex: 1 }),
          makePlayer({ id: 'p3', name: 'Carol', trueRole: 'washerwoman', seatIndex: 2 }),
          makePlayer({ id: 'p4', name: 'Dave', trueRole: 'poisoner', seatIndex: 3 }),
          makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', seatIndex: 4 }),
          makePlayer({ id: 'p6', name: 'Frank', trueRole: 'empath', seatIndex: 5 }),
          makePlayer({ id: 'p7', name: 'Grace', trueRole: 'librarian', seatIndex: 6 }),
        ],
      };
    });

    it('Saint execution triggers Evil win immediately', () => {
      state = addNomination(state, 'p3', 'p2'); // nominate the Saint
      state = startVote(state, 0);
      for (let i = 0; i < 7; i++) {
        if (`p${i + 1}` !== 'p2') state = recordVote(state, 0, `p${i + 1}`, true);
      }
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.winner).toBe('evil');
      expect(result.phase).toBe('ended');
      expect(result.executedPlayerId).toBe('p2');
    });

    it('Saint execution loss triggers before other end-of-day checks', () => {
      // Even though there are enough players and no other win conditions,
      // Saint execution causes immediate Evil win
      state = addNomination(state, 'p3', 'p2');
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p1', true);
      state = recordVote(state, 0, 'p3', true);
      state = recordVote(state, 0, 'p4', true);
      state = recordVote(state, 0, 'p5', true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.winner).toBe('evil');
      expect(result.phase).toBe('ended');
      // The Saint is dead
      const saint = result.players.find((p) => p.id === 'p2');
      expect(saint!.isAlive).toBe(false);
    });

    it('poisoned Saint execution does not trigger Evil win', () => {
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p2' ? { ...p, isPoisoned: true } : p
        ),
      };

      state = addNomination(state, 'p3', 'p2');
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p1', true);
      state = recordVote(state, 0, 'p3', true);
      state = recordVote(state, 0, 'p4', true);
      state = recordVote(state, 0, 'p5', true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBe('p2');
      expect(result.winner).toBeNull();
      expect(result.phase).not.toBe('ended');
    });

    it('Saint dying at night (Demon kill) does not trigger loss', () => {
      // Add Saint to pending deaths (as if killed by Imp at night)
      state = { ...state, phase: 'night' };
      state = addPendingDeath(state, 'p2');
      expect(state.pendingDeaths).toContain('p2');

      // Resolve dawn deaths
      const result = resolveDawnDeaths(state);
      const saint = result.players.find((p) => p.id === 'p2');
      expect(saint!.isAlive).toBe(false);
      // No Evil win triggered
      expect(result.winner).toBeNull();
      expect(result.phase).toBe('day');
    });

    it('dead Saint has no effect on execution of other players', () => {
      // Kill the Saint first (night death), then execute someone else
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p2' ? { ...p, isAlive: false } : p
        ),
      };

      // Execute a Townsfolk - should not trigger Evil win
      state = addNomination(state, 'p4', 'p3');
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p1', true);
      state = recordVote(state, 0, 'p4', true);
      state = recordVote(state, 0, 'p5', true);
      state = recordVote(state, 0, 'p6', true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBe('p3');
      expect(result.winner).toBeNull();
    });

    it('non-Saint execution does not trigger Saint loss condition', () => {
      // Execute a Townsfolk, not the Saint - no Evil win
      state = addNomination(state, 'p2', 'p3'); // nominate Carol (washerwoman)
      state = startVote(state, 0);
      state = recordVote(state, 0, 'p1', true);
      state = recordVote(state, 0, 'p4', true);
      state = recordVote(state, 0, 'p5', true);
      state = recordVote(state, 0, 'p6', true);
      state = resolveVote(state, 0);

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBe('p3');
      expect(result.winner).toBeNull(); // No win condition triggered
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

      host.emit('start_game', { gameId: 'game-1' });
      await waitForEvent(host, 'game_started');
      await new Promise<void>((r) => setTimeout(r, 50));

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

      const voteResultPromise = waitForEvent(host, 'vote_result');
      host.emit('reveal_votes', { gameId });
      await voteResultPromise;
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    it('Saint execution triggers game_over with Evil win via WebSocket', async () => {
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

    it('poisoned Saint execution does not trigger game_over', async () => {
      const { host, players, gameId } = await setupGameInNomination(7);

      // Set one player as poisoned Saint, ensure Imp is alive so checkWinConditions doesn't end game
      const game = store.games.get(gameId)!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p, i) => {
          if (p.id === players[1].id!) return { ...p, trueRole: 'saint' as const, isPoisoned: true };
          if (i === game.players.length - 1) return { ...p, trueRole: 'imp' as const };
          return p;
        }),
      });

      await nominateAndVote(host, players[0], players[1].id!, [players[2], players[3], players[4], players[5]], gameId);

      const execResultPromise = waitForEvent(host, 'execution_result');
      host.emit('resolve_execution', { gameId });
      const result = (await execResultPromise) as { executed: { playerId: string } | null };

      expect(result.executed).not.toBeNull();
      expect(result.executed!.playerId).toBe(players[1].id!);

      // Verify game is NOT ended
      const gameState = store.games.get(gameId)!;
      expect(gameState.winner).toBeNull();
      expect(gameState.phase).not.toBe('ended');
    });
  });
});
