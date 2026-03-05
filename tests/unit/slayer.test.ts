import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  processSlayerAction,
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

describe('Slayer', () => {
  // --- State machine unit tests ---

  describe('processSlayerAction', () => {
    it('kills the Demon when Slayer targets the Demon', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'imp', 'imp', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'washerwoman', 'washerwoman', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.targetDied).toBe(true);
      expect(result.state.slayerAbilityUsed).toBe(true);

      const demon = result.state.players.find((p) => p.id === 'p2')!;
      expect(demon.isAlive).toBe(false);
    });

    it('does nothing when Slayer targets a non-Demon player', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'washerwoman', 'washerwoman', { seatIndex: 1 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.targetDied).toBe(false);
      expect(result.state.slayerAbilityUsed).toBe(true);

      const target = result.state.players.find((p) => p.id === 'p2')!;
      expect(target.isAlive).toBe(true);
    });

    it('ability is spent after one use regardless of outcome', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'washerwoman', 'washerwoman', { seatIndex: 1 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.state.slayerAbilityUsed).toBe(true);

      // Second attempt should not trigger
      const result2 = processSlayerAction(result.state, 'p1', 'p2');
      expect(result2.state).toBe(result.state); // same reference — no change
    });

    it('has no effect when Slayer is poisoned (even targeting the Demon)', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0, isPoisoned: true }),
          makePlayer('p2', 'Bob', 'imp', 'imp', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'washerwoman', 'washerwoman', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.targetDied).toBe(false);
      expect(result.state.slayerAbilityUsed).toBe(true);

      const demon = result.state.players.find((p) => p.id === 'p2')!;
      expect(demon.isAlive).toBe(true);
    });

    it('has no effect when Slayer is drunk (even targeting the Demon)', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer('p1', 'Alice', 'drunk', 'slayer', { seatIndex: 0, isDrunk: true }),
          makePlayer('p2', 'Bob', 'imp', 'imp', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'washerwoman', 'washerwoman', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.targetDied).toBe(false);
      expect(result.state.slayerAbilityUsed).toBe(true);

      const demon = result.state.players.find((p) => p.id === 'p2')!;
      expect(demon.isAlive).toBe(true);
    });

    it('triggers Scarlet Woman if Demon killed with 5+ alive', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'imp', 'imp', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'scarletWoman', 'scarletWoman', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'washerwoman', 'washerwoman', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.targetDied).toBe(true);
      expect(result.state.winner).toBeNull();
      expect(result.state.phase).toBe('day'); // game continues

      // Scarlet Woman became the new Imp
      const sw = result.state.players.find((p) => p.id === 'p3')!;
      expect(sw.trueRole).toBe('imp');
    });

    it('Good wins when Demon killed by Slayer (no Scarlet Woman)', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'imp', 'imp', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'washerwoman', 'washerwoman', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.targetDied).toBe(true);
      expect(result.state.winner).toBe('good');
      expect(result.state.phase).toBe('ended');
    });

    it('logs slayer_action event', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'washerwoman', 'washerwoman', { seatIndex: 1 }),
        ],
      };

      const result = processSlayerAction(state, 'p1', 'p2');
      expect(result.state.gameLog.some((l) => l.type === 'slayer_action')).toBe(true);
    });

    it('is pure and does not mutate original state', () => {
      let state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        players: [
          makePlayer('p1', 'Alice', 'slayer', 'slayer', { seatIndex: 0 }),
          makePlayer('p2', 'Bob', 'imp', 'imp', { seatIndex: 1 }),
          makePlayer('p3', 'Carol', 'washerwoman', 'washerwoman', { seatIndex: 2 }),
          makePlayer('p4', 'Dave', 'poisoner', 'poisoner', { seatIndex: 3 }),
          makePlayer('p5', 'Eve', 'chef', 'chef', { seatIndex: 4 }),
        ],
      };

      const originalUsed = state.slayerAbilityUsed;
      processSlayerAction(state, 'p1', 'p2');
      expect(state.slayerAbilityUsed).toBe(originalUsed);
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

      host.emit('start_discussion', { gameId: 'game-1' });
      await waitForEvent(host, 'discussion_started');
      await new Promise<void>((r) => setTimeout(r, 50));

      return { host, players, gameId: 'game-1' };
    }

    it('Slayer kills the Demon and all clients receive slayer_result', async () => {
      const { host, players, gameId } = await setupGameInDay(7);
      const game = store.games.get(gameId)!;

      const slayerId = players[0].id!;
      const demonId = players[1].id!;
      // Ensure no Scarlet Woman in the game (random assignment could include one, preventing game_over)
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === slayerId) return { ...p, trueRole: 'slayer' as const, apparentRole: 'slayer' as const };
          if (p.id === demonId) return { ...p, trueRole: 'imp' as const, apparentRole: 'imp' as const };
          if (p.trueRole === 'scarletWoman') return { ...p, trueRole: 'poisoner' as const, apparentRole: 'poisoner' as const };
          return p;
        }),
      });

      const slayerPromise = waitForEvent(host, 'slayer_result');
      const gameOverPromise = waitForEvent(host, 'game_over');
      players[0].emit('slayer_action', { gameId, targetPlayerId: demonId });

      const slayerData = await slayerPromise as { slayerId: string; targetId: string; targetDied: boolean };
      expect(slayerData.slayerId).toBe(slayerId);
      expect(slayerData.targetId).toBe(demonId);
      expect(slayerData.targetDied).toBe(true);

      const gameOverData = await gameOverPromise as { winner: string };
      expect(gameOverData.winner).toBe('good');
    });

    it('Slayer misses non-Demon target and no one dies', async () => {
      const { host, players, gameId } = await setupGameInDay(7);
      const game = store.games.get(gameId)!;

      const slayerId = players[0].id!;
      const targetId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === slayerId) return { ...p, trueRole: 'slayer' as const, apparentRole: 'slayer' as const };
          if (p.id === targetId) return { ...p, trueRole: 'washerwoman' as const, apparentRole: 'washerwoman' as const };
          return p;
        }),
      });

      const slayerPromise = waitForEvent(host, 'slayer_result');
      players[0].emit('slayer_action', { gameId, targetPlayerId: targetId });

      const slayerData = await slayerPromise as { targetDied: boolean };
      expect(slayerData.targetDied).toBe(false);

      const updatedGame = store.games.get(gameId)!;
      expect(updatedGame.slayerAbilityUsed).toBe(true);
      const target = updatedGame.players.find((p) => p.id === targetId)!;
      expect(target.isAlive).toBe(true);
    });

    it('poisoned Slayer has no effect even targeting the Demon', async () => {
      const { host, players, gameId } = await setupGameInDay(7);
      const game = store.games.get(gameId)!;

      const slayerId = players[0].id!;
      const demonId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === slayerId) return { ...p, trueRole: 'slayer' as const, apparentRole: 'slayer' as const, isPoisoned: true };
          if (p.id === demonId) return { ...p, trueRole: 'imp' as const, apparentRole: 'imp' as const };
          return p;
        }),
      });

      const slayerPromise = waitForEvent(host, 'slayer_result');
      players[0].emit('slayer_action', { gameId, targetPlayerId: demonId });

      const slayerData = await slayerPromise as { targetDied: boolean };
      expect(slayerData.targetDied).toBe(false);

      const updatedGame = store.games.get(gameId)!;
      const demon = updatedGame.players.find((p) => p.id === demonId)!;
      expect(demon.isAlive).toBe(true);
    });

    it('second use of Slayer ability returns an error', async () => {
      const { players, gameId } = await setupGameInDay(7);
      const game = store.games.get(gameId)!;

      const slayerId = players[0].id!;
      const targetId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        slayerAbilityUsed: true,
        players: game.players.map((p) => {
          if (p.id === slayerId) return { ...p, trueRole: 'slayer' as const, apparentRole: 'slayer' as const };
          return p;
        }),
      });

      const errorPromise = waitForEvent(players[0], 'slayer_error');
      players[0].emit('slayer_action', { gameId, targetPlayerId: targetId });

      const errorData = await errorPromise as { message: string };
      expect(errorData.message).toContain('already been used');
    });

    it('non-Slayer player cannot use slayer_action', async () => {
      const { players, gameId } = await setupGameInDay(7);
      const game = store.games.get(gameId)!;

      const nonSlayerId = players[0].id!;
      const targetId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        players: game.players.map((p) => {
          if (p.id === nonSlayerId) return { ...p, trueRole: 'washerwoman' as const, apparentRole: 'washerwoman' as const };
          return p;
        }),
      });

      const errorPromise = waitForEvent(players[0], 'slayer_error');
      players[0].emit('slayer_action', { gameId, targetPlayerId: targetId });

      const errorData = await errorPromise as { message: string };
      expect(errorData.message).toContain('not the Slayer');
    });

    it('cannot use Slayer ability during night phase', async () => {
      const { players, gameId } = await setupGameInDay(7);
      const game = store.games.get(gameId)!;

      const slayerId = players[0].id!;
      const targetId = players[1].id!;
      store.games.set(gameId, {
        ...game,
        phase: 'night',
        players: game.players.map((p) => {
          if (p.id === slayerId) return { ...p, trueRole: 'slayer' as const, apparentRole: 'slayer' as const };
          return p;
        }),
      });

      const errorPromise = waitForEvent(players[0], 'slayer_error');
      players[0].emit('slayer_action', { gameId, targetPlayerId: targetId });

      const errorData = await errorPromise as { message: string };
      expect(errorData.message).toContain('during the day');
    });
  });
});
