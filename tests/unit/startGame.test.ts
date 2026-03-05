import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createInitialGameState, addPlayer } from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, Player } from '../../src/types/game.js';

describe('start game', () => {
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

  function makePlayer(id: string, name: string, seatIndex: number): Player {
    return {
      id,
      name,
      trueRole: 'washerwoman',
      apparentRole: 'washerwoman',
      isAlive: true,
      isPoisoned: false,
      isDrunk: false,
      hasGhostVote: true,
      ghostVoteUsed: false,
      seatIndex,
    };
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

  it('host can start the game only when player count is between 5 and 15', async () => {
    const host = createClient();
    await waitForEvent(host, 'connect');

    // Create game with host as storyteller
    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    // Add only 3 players (too few)
    let g = game;
    for (let i = 0; i < 3; i++) {
      g = addPlayer(g, makePlayer(`p${i}`, `Player${i}`, i));
    }
    store.games.set(g.id, g);

    // Join the room so we receive events
    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');

    // Try to start with too few players (3 + host = 4)
    const errorPromise = waitForEvent(host, 'start_error');
    host.emit('start_game', { gameId: 'game-1' });

    const err = (await errorPromise) as { message: string };
    expect(err.message).toBe('Player count must be between 5 and 15');
  });

  it('starting the game transitions all connected clients to the game phase', async () => {
    const host = createClient();
    await waitForEvent(host, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    // Host joins
    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Add 4 more players via socket
    const playerClients: ClientSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const p = createClient();
      await waitForEvent(p, 'connect');
      p.emit('join_game', { joinCode: 'ABC123', playerName: `Player${i}` });
      await waitForEvent(p, 'game_joined');
      playerClients.push(p);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // Now we have 5 players (host + 4). Start the game.
    const gameStartedPromises = [host, ...playerClients].map((c) =>
      waitForEvent(c, 'game_started')
    );
    const statePromises = [host, ...playerClients].map((c) =>
      waitForEvent(c, 'game_state')
    );

    host.emit('start_game', { gameId: 'game-1' });

    const startedResults = await Promise.all(gameStartedPromises);
    for (const r of startedResults) {
      expect((r as { gameId: string }).gameId).toBe('game-1');
    }

    const stateResults = await Promise.all(statePromises);
    for (const s of stateResults) {
      expect((s as GameState).phase).toBe('setup');
    }
  });

  it('only the host can start the game', async () => {
    const host = createClient();
    await waitForEvent(host, 'connect');
    const player = createClient();
    await waitForEvent(player, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');

    player.emit('join_game', { joinCode: 'ABC123', playerName: 'Player1' });
    await waitForEvent(player, 'game_joined');

    const errorPromise = waitForEvent(player, 'start_error');
    player.emit('start_game', { gameId: 'game-1' });

    const err = (await errorPromise) as { message: string };
    expect(err.message).toBe('Only the host can start the game');
  });

  it('players who disconnect from the lobby are removed from the player list', async () => {
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    store.games.set(game.id, game);

    const host = createClient();
    await waitForEvent(host, 'connect');
    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const player = createClient();
    await waitForEvent(player, 'connect');
    player.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });
    await waitForEvent(player, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(store.games.get('game-1')!.players).toHaveLength(2);

    // Set up listener for player_left on host
    const playerLeftPromise = waitForEvent(host, 'player_left');

    // Disconnect Alice
    player.disconnect();

    const leftData = (await playerLeftPromise) as { playerId: string };
    expect(leftData.playerId).toBeTruthy();

    // Wait for state update
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(store.games.get('game-1')!.players).toHaveLength(1);
    expect(store.games.get('game-1')!.players[0].name).toBe('Host');
  });

  it('host sees all connected players listed (via game_state)', async () => {
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    store.games.set(game.id, game);

    const host = createClient();
    await waitForEvent(host, 'connect');

    const gameStates: GameState[] = [];
    host.on('game_state', (data: GameState) => gameStates.push(data));

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const p1 = createClient();
    await waitForEvent(p1, 'connect');
    p1.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });
    await waitForEvent(p1, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const p2 = createClient();
    await waitForEvent(p2, 'connect');
    p2.emit('join_game', { joinCode: 'ABC123', playerName: 'Bob' });
    await waitForEvent(p2, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const latestState = gameStates[gameStates.length - 1];
    expect(latestState.players).toHaveLength(3);
    const names = latestState.players.map((p) => p.name);
    expect(names).toContain('Host');
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });
});
