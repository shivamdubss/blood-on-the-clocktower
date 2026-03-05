import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  checkMayorWin,
  processImpAction,
  poisonPlayer,
  resolveExecution,
} from '../../src/server/gameStateMachine.js';
import { metadata as mayorMetadata } from '../../src/roles/mayor.js';
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

describe('Mayor', () => {
  describe('state machine', () => {
    let state: GameState;

    beforeEach(() => {
      state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'end',
        players: [
          makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', seatIndex: 0 }),
          makePlayer({ id: 'p2', name: 'Bob', trueRole: 'mayor', seatIndex: 1 }),
          makePlayer({ id: 'p3', name: 'Carol', trueRole: 'washerwoman', seatIndex: 2 }),
        ],
      };
    });

    // --- Mayor 3-player win ---

    it('Good wins if 3 players alive, no execution, Mayor alive and not poisoned', () => {
      const result = checkMayorWin(state);
      expect(result.phase).toBe('ended');
      expect(result.winner).toBe('good');
    });

    it('Mayor win does not trigger if an execution occurred', () => {
      state = { ...state, executedPlayerId: 'p3' };
      const result = checkMayorWin(state);
      expect(result.phase).toBe('day');
      expect(result.winner).toBeNull();
    });

    it('Mayor win does not trigger if more than 3 players alive', () => {
      state = {
        ...state,
        players: [
          ...state.players,
          makePlayer({ id: 'p4', name: 'Dave', trueRole: 'poisoner', seatIndex: 3 }),
        ],
      };
      const result = checkMayorWin(state);
      expect(result.phase).toBe('day');
    });

    it('Mayor win does not trigger if Mayor is dead', () => {
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === 'p2' ? { ...p, isAlive: false } : p
        ),
      };
      // Only 2 alive, not 3
      const result = checkMayorWin(state);
      expect(result.phase).toBe('day');
    });

    it('Mayor win does not trigger if Mayor is poisoned', () => {
      state = poisonPlayer(state, 'p2');
      const result = checkMayorWin(state);
      expect(result.phase).toBe('day');
      expect(result.winner).toBeNull();
    });

    // --- Mayor bounce/redirect ---

    it('Demon kill on Mayor is redirected to another player chosen by Storyteller', () => {
      // 5 players for the redirect scenario
      state = {
        ...state,
        phase: 'night',
        players: [
          makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', seatIndex: 0 }),
          makePlayer({ id: 'p2', name: 'Bob', trueRole: 'mayor', seatIndex: 1 }),
          makePlayer({ id: 'p3', name: 'Carol', trueRole: 'washerwoman', seatIndex: 2 }),
          makePlayer({ id: 'p4', name: 'Dave', trueRole: 'poisoner', seatIndex: 3 }),
          makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', seatIndex: 4 }),
        ],
      };

      const result = processImpAction(state, 'p2', 'p1', undefined, 'p3');
      // Mayor (p2) should NOT be in pending deaths
      expect(result.pendingDeaths).not.toContain('p2');
      // Redirect target (p3) should be in pending deaths
      expect(result.pendingDeaths).toContain('p3');
      // Game log records mayor_bounce
      const bounceLog = result.gameLog.find((l) => l.type === 'mayor_bounce');
      expect(bounceLog).toBeDefined();
      expect((bounceLog!.data as { mayorPlayerId: string }).mayorPlayerId).toBe('p2');
      expect((bounceLog!.data as { redirectTargetId: string }).redirectTargetId).toBe('p3');
    });

    it('Mayor bounce does not apply if Mayor is poisoned', () => {
      state = {
        ...state,
        phase: 'night',
        players: [
          makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', seatIndex: 0 }),
          makePlayer({ id: 'p2', name: 'Bob', trueRole: 'mayor', isPoisoned: true, seatIndex: 1 }),
          makePlayer({ id: 'p3', name: 'Carol', trueRole: 'washerwoman', seatIndex: 2 }),
          makePlayer({ id: 'p4', name: 'Dave', trueRole: 'poisoner', seatIndex: 3 }),
          makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', seatIndex: 4 }),
        ],
      };

      const result = processImpAction(state, 'p2', 'p1', undefined, 'p3');
      // Mayor should be killed (poisoned, no bounce)
      expect(result.pendingDeaths).toContain('p2');
      // Redirect target should NOT be in pending deaths
      expect(result.pendingDeaths).not.toContain('p3');
      // No mayor_bounce log
      const bounceLog = result.gameLog.find((l) => l.type === 'mayor_bounce');
      expect(bounceLog).toBeUndefined();
    });

    it('Mayor bounce does not apply if no redirect target is provided', () => {
      state = {
        ...state,
        phase: 'night',
        players: [
          makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', seatIndex: 0 }),
          makePlayer({ id: 'p2', name: 'Bob', trueRole: 'mayor', seatIndex: 1 }),
          makePlayer({ id: 'p3', name: 'Carol', trueRole: 'washerwoman', seatIndex: 2 }),
          makePlayer({ id: 'p4', name: 'Dave', trueRole: 'poisoner', seatIndex: 3 }),
          makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', seatIndex: 4 }),
        ],
      };

      // No mayorRedirectPlayerId provided — Storyteller chose not to redirect
      const result = processImpAction(state, 'p2', 'p1');
      // Mayor should be killed normally
      expect(result.pendingDeaths).toContain('p2');
    });

    it('Mayor is a passive role with no night action', () => {
      expect(mayorMetadata.firstNight).toBe(false);
      expect(mayorMetadata.otherNights).toBe(false);
    });

    it('checkMayorWin is a pure function and does not mutate state', () => {
      const original = JSON.parse(JSON.stringify(state));
      checkMayorWin(state);
      expect(JSON.parse(JSON.stringify(state))).toEqual(original);
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

    async function setupGameInDay(playerCount: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
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

      // Transition to day
      const currentGame = store.games.get('game-1')!;
      store.games.set('game-1', { ...currentGame, phase: 'night' });

      host.emit('transition_to_day', { gameId: 'game-1' });
      await waitForEvent(host, 'dawn_announcement');
      await new Promise<void>((r) => setTimeout(r, 50));

      return { host, players, gameId: 'game-1' };
    }

    it('Mayor win triggers game_over when 3 alive, no execution, Storyteller ends day', async () => {
      const { host, gameId } = await setupGameInDay(5);
      const game = store.games.get(gameId)!;

      // Set up: 3 alive players with Mayor, kill 2 players
      const updatedPlayers = game.players.map((p, i) => {
        if (i === 0) return { ...p, trueRole: 'imp' as RoleId, apparentRole: 'imp' as RoleId };
        if (i === 1) return { ...p, trueRole: 'mayor' as RoleId, apparentRole: 'mayor' as RoleId };
        if (i === 2) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId };
        // Kill player 3 and 4
        return { ...p, trueRole: 'chef' as RoleId, apparentRole: 'chef' as RoleId, isAlive: false };
      });

      store.games.set(gameId, {
        ...game,
        players: updatedPlayers,
        daySubPhase: 'nomination',
      });

      // Close nominations (no nominations made = no execution)
      host.emit('close_nominations', { gameId });
      await waitForEvent(host, 'nominations_closed');
      await new Promise<void>((r) => setTimeout(r, 50));

      // Listen for game_over before ending the day
      const gameOverPromise = waitForEvent(host, 'game_over');

      host.emit('end_day', { gameId });
      const gameOver = (await gameOverPromise) as { winner: string; players: Array<{ trueRole: string }> };

      expect(gameOver.winner).toBe('good');
      // All roles revealed
      expect(gameOver.players.length).toBeGreaterThanOrEqual(3);
    });

    it('Mayor win does not trigger when Mayor is poisoned via WebSocket', async () => {
      const { host, gameId } = await setupGameInDay(5);
      const game = store.games.get(gameId)!;

      const updatedPlayers = game.players.map((p, i) => {
        if (i === 0) return { ...p, trueRole: 'imp' as RoleId, apparentRole: 'imp' as RoleId };
        if (i === 1) return { ...p, trueRole: 'mayor' as RoleId, apparentRole: 'mayor' as RoleId, isPoisoned: true };
        if (i === 2) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId };
        return { ...p, trueRole: 'chef' as RoleId, apparentRole: 'chef' as RoleId, isAlive: false };
      });

      store.games.set(gameId, {
        ...game,
        players: updatedPlayers,
        daySubPhase: 'nomination',
      });

      host.emit('close_nominations', { gameId });
      await waitForEvent(host, 'nominations_closed');
      await new Promise<void>((r) => setTimeout(r, 50));

      // Should get night_started, NOT game_over
      const nightStartedPromise = waitForEvent(host, 'night_started');
      host.emit('end_day', { gameId });
      const nightStarted = await nightStartedPromise;
      expect(nightStarted).toBeDefined();

      // Game should NOT be ended
      const finalGame = store.games.get(gameId)!;
      expect(finalGame.phase).toBe('night');
    });

    it('Mayor bounce redirects Imp kill via night queue submission', async () => {
      const { host, players, gameId } = await setupGameInDay(7);
      const game = store.games.get(gameId)!;

      const impId = players[0].id!;
      const mayorId = players[1].id!;
      const redirectTargetId = players[2].id!;

      const updatedPlayers = game.players.map((p) => {
        if (p.id === impId) return { ...p, trueRole: 'imp' as RoleId, apparentRole: 'imp' as RoleId };
        if (p.id === mayorId) return { ...p, trueRole: 'mayor' as RoleId, apparentRole: 'mayor' as RoleId };
        if (p.trueRole === 'imp' && p.id !== impId) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId };
        // Ensure no Scarlet Woman to avoid unexpected trigger
        if (p.trueRole === 'scarletWoman') return { ...p, trueRole: 'chef' as RoleId, apparentRole: 'chef' as RoleId };
        return p;
      });

      // Set up night with Imp in queue targeting Mayor, with redirect
      store.games.set(gameId, {
        ...game,
        phase: 'night',
        players: updatedPlayers,
        nightQueue: [{ roleId: 'imp' as RoleId, playerId: impId, completed: false }],
        nightQueuePosition: 0,
      });

      host.emit('submit_night_action', {
        gameId,
        input: { targetPlayerId: mayorId, mayorRedirectPlayerId: redirectTargetId },
      });

      await waitForEvent(host, 'night_action_confirmed');
      await new Promise<void>((r) => setTimeout(r, 50));

      // End the night
      host.emit('end_night', { gameId });
      const dawn = (await waitForEvent(host, 'dawn_announcement')) as { deaths: Array<{ playerName: string }> };

      // The redirect target should have died, not the Mayor
      const finalGame = store.games.get(gameId)!;
      const mayor = finalGame.players.find((p) => p.id === mayorId)!;
      const redirectTarget = finalGame.players.find((p) => p.id === redirectTargetId)!;
      expect(mayor.isAlive).toBe(true);
      expect(redirectTarget.isAlive).toBe(false);
    });
  });
});
