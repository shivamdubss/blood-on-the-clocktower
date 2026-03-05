import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addPlayer,
  processImpAction,
  resolveExecution,
  poisonPlayer,
} from '../../src/server/gameStateMachine.js';
import { metadata as soldierMetadata } from '../../src/roles/soldier.js';
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

describe('Soldier', () => {
  describe('state machine', () => {
    let state: GameState;

    beforeEach(() => {
      state = createInitialGameState('g1', 'ABC', 'st1');
      state = {
        ...state,
        phase: 'day',
        daySubPhase: 'discussion',
        players: [
          makePlayer({ id: 'p1', name: 'Alice', trueRole: 'imp', seatIndex: 0 }),
          makePlayer({ id: 'p2', name: 'Bob', trueRole: 'soldier', seatIndex: 1 }),
          makePlayer({ id: 'p3', name: 'Carol', trueRole: 'washerwoman', seatIndex: 2 }),
          makePlayer({ id: 'p4', name: 'Dave', trueRole: 'poisoner', seatIndex: 3 }),
          makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', seatIndex: 4 }),
        ],
      };
    });

    it('Soldier is protected from the Demon night kill', () => {
      const result = processImpAction(state, 'p2', 'p1');
      // Kill should be blocked
      expect(result.pendingDeaths).not.toContain('p2');
      const soldier = result.players.find((p) => p.id === 'p2')!;
      expect(soldier.isAlive).toBe(true);
      // Game log should record the block
      const blockLog = result.gameLog.find((l) => l.type === 'imp_kill_blocked');
      expect(blockLog).toBeDefined();
      expect((blockLog!.data as { reason: string }).reason).toBe('soldier_protection');
    });

    it('poisoned Soldier loses protection and can be killed by the Demon', () => {
      state = poisonPlayer(state, 'p2');
      const result = processImpAction(state, 'p2', 'p1');
      // Kill should succeed
      expect(result.pendingDeaths).toContain('p2');
      const killLog = result.gameLog.find((l) => l.type === 'imp_kill');
      expect(killLog).toBeDefined();
    });

    it('Soldier protection does not apply to execution', () => {
      // Set up a nomination where Soldier has the highest passing vote
      state = {
        ...state,
        nominations: [
          {
            nominatorId: 'p3',
            nomineeId: 'p2', // Soldier
            votes: ['p1', 'p3', 'p4'],
            votesSubmitted: ['p1', 'p2', 'p3', 'p4', 'p5'],
            voteCount: 3,
            passed: true,
          },
        ],
      };

      const result = resolveExecution(state);
      expect(result.executedPlayerId).toBe('p2');
      const soldier = result.players.find((p) => p.id === 'p2')!;
      expect(soldier.isAlive).toBe(false);
    });

    it('Soldier protection is passive and requires no night action', () => {
      expect(soldierMetadata.firstNight).toBe(false);
      expect(soldierMetadata.otherNights).toBe(false);
    });

    it('Imp kill is blocked by Soldier and state is not mutated', () => {
      const originalPlayers = state.players.map((p) => ({ ...p }));
      const result = processImpAction(state, 'p2', 'p1');
      // Original state is unchanged (pure function)
      expect(state.players.map((p) => p.isAlive)).toEqual(originalPlayers.map((p) => p.isAlive));
      // Result still has Soldier alive
      const soldier = result.players.find((p) => p.id === 'p2')!;
      expect(soldier.isAlive).toBe(true);
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

    async function setupGameInNight(playerCount: number): Promise<{ host: ClientSocket; players: ClientSocket[]; gameId: string }> {
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

      // Transition to day first, then to night
      const currentGame = store.games.get('game-1')!;
      store.games.set('game-1', { ...currentGame, phase: 'night' });

      host.emit('transition_to_day', { gameId: 'game-1' });
      await waitForEvent(host, 'dawn_announcement');
      await new Promise<void>((r) => setTimeout(r, 50));

      host.emit('start_discussion', { gameId: 'game-1' });
      await waitForEvent(host, 'discussion_started');
      await new Promise<void>((r) => setTimeout(r, 50));

      host.emit('open_nominations', { gameId: 'game-1' });
      await waitForEvent(host, 'nominations_opened');
      await new Promise<void>((r) => setTimeout(r, 50));

      host.emit('close_nominations', { gameId: 'game-1' });
      await waitForEvent(host, 'nominations_closed');
      await new Promise<void>((r) => setTimeout(r, 50));

      host.emit('end_day', { gameId: 'game-1' });
      await waitForEvent(host, 'night_started');
      await new Promise<void>((r) => setTimeout(r, 50));

      return { host, players, gameId: 'game-1' };
    }

    it('Soldier survives Imp night kill via processImpAction in night queue', async () => {
      const { host, players, gameId } = await setupGameInNight(7);
      const game = store.games.get(gameId)!;

      // Set roles: make one player the Soldier and one the Imp
      const impId = players[0].id!;
      const soldierId = players[1].id!;
      const updatedPlayers = game.players.map((p) => {
        if (p.id === impId) return { ...p, trueRole: 'imp' as RoleId, apparentRole: 'imp' as RoleId };
        if (p.id === soldierId) return { ...p, trueRole: 'soldier' as RoleId, apparentRole: 'soldier' as RoleId };
        if (p.trueRole === 'imp' && p.id !== impId) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId };
        return p;
      });

      // Build a night queue with just the Imp targeting the Soldier
      store.games.set(gameId, {
        ...game,
        players: updatedPlayers,
        nightQueue: [{ roleId: 'imp' as RoleId, playerId: impId, completed: false }],
        nightQueuePosition: 0,
      });

      // Submit the Imp's night action targeting the Soldier
      const confirmPromise = waitForEvent(host, 'night_action_confirmed');
      host.emit('submit_night_action', { gameId, input: { targetPlayerId: soldierId } });
      await confirmPromise;
      await new Promise<void>((r) => setTimeout(r, 50));

      // End the night
      const dawnPromise = waitForEvent(host, 'dawn_announcement');
      host.emit('end_night', { gameId });
      const dawn = await dawnPromise as { deaths: Array<{ playerId: string }> };

      // Soldier should NOT be in the deaths list
      expect(dawn.deaths.find((d) => d.playerId === soldierId)).toBeUndefined();

      const updatedGame = store.games.get(gameId)!;
      const soldier = updatedGame.players.find((p) => p.id === soldierId)!;
      expect(soldier.isAlive).toBe(true);
    });

    it('poisoned Soldier is killed by Imp night kill', async () => {
      const { host, players, gameId } = await setupGameInNight(7);
      const game = store.games.get(gameId)!;

      const impId = players[0].id!;
      const soldierId = players[1].id!;
      const updatedPlayers = game.players.map((p) => {
        if (p.id === impId) return { ...p, trueRole: 'imp' as RoleId, apparentRole: 'imp' as RoleId };
        if (p.id === soldierId) return { ...p, trueRole: 'soldier' as RoleId, apparentRole: 'soldier' as RoleId, isPoisoned: true };
        if (p.trueRole === 'imp' && p.id !== impId) return { ...p, trueRole: 'washerwoman' as RoleId, apparentRole: 'washerwoman' as RoleId };
        return p;
      });

      store.games.set(gameId, {
        ...game,
        players: updatedPlayers,
        nightQueue: [{ roleId: 'imp' as RoleId, playerId: impId, completed: false }],
        nightQueuePosition: 0,
      });

      const confirmPromise = waitForEvent(host, 'night_action_confirmed');
      host.emit('submit_night_action', { gameId, input: { targetPlayerId: soldierId } });
      await confirmPromise;
      await new Promise<void>((r) => setTimeout(r, 50));

      const dawnPromise = waitForEvent(host, 'dawn_announcement');
      host.emit('end_night', { gameId });
      const dawn = await dawnPromise as { deaths: Array<{ playerId: string }> };

      // Poisoned Soldier SHOULD be in the deaths list
      expect(dawn.deaths.find((d) => d.playerId === soldierId)).toBeDefined();

      const updatedGame = store.games.get(gameId)!;
      const soldier = updatedGame.players.find((p) => p.id === soldierId)!;
      expect(soldier.isAlive).toBe(false);
    });
  });
});
