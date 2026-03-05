import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createInitialGameState, addPlayer } from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState } from '../../src/types/game.js';

describe('join game', () => {
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

  it('player enters join code and display name, receives confirmation and WebSocket connection', async () => {
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    store.games.set(game.id, game);

    const client = createClient();
    await waitForEvent(client, 'connect');

    const joinedPromise = waitForEvent(client, 'game_joined');
    const statePromise = waitForEvent(client, 'game_state');
    client.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });

    const joinedData = (await joinedPromise) as { gameId: string; playerId: string };
    expect(joinedData.gameId).toBe('game-1');
    expect(joinedData.playerId).toBeTruthy();

    const gameState = (await statePromise) as GameState;
    expect(gameState.players).toHaveLength(1);
    expect(gameState.players[0].name).toBe('Alice');
  });

  it('host sees new player appear in real time via WebSocket', async () => {
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    store.games.set(game.id, game);

    const host = createClient();
    await waitForEvent(host, 'connect');

    // Collect all player_joined events on the host
    const playerJoinedEvents: unknown[] = [];
    const gameStateEvents: unknown[] = [];
    host.on('player_joined', (data: unknown) => playerJoinedEvents.push(data));
    host.on('game_state', (data: unknown) => gameStateEvents.push(data));

    // Host joins first
    const hostJoinedPromise = waitForEvent(host, 'game_joined');
    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await hostJoinedPromise;

    // Wait a tick for the game_state to arrive
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(gameStateEvents.length).toBeGreaterThanOrEqual(1);

    const stateCountBefore = gameStateEvents.length;

    // Player joins; host should be notified
    const player = createClient();
    await waitForEvent(player, 'connect');
    player.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });

    // Wait for events to arrive
    await new Promise<void>((r) => setTimeout(r, 200));

    // Host should have received a player_joined event for Alice
    const aliceJoined = playerJoinedEvents.find(
      (e) => (e as { player: { name: string } }).player.name === 'Alice'
    );
    expect(aliceJoined).toBeTruthy();

    // Host should have received a new game_state with 2 players
    const latestState = gameStateEvents[gameStateEvents.length - 1] as GameState;
    expect(latestState.players).toHaveLength(2);
    expect(latestState.players.map((p) => p.name)).toContain('Alice');
  });

  it('duplicate display names within the same game are rejected with an error message', async () => {
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    store.games.set(game.id, game);

    const client1 = createClient();
    await waitForEvent(client1, 'connect');
    const joined1 = waitForEvent(client1, 'game_joined');
    client1.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });
    await joined1;

    const client2 = createClient();
    await waitForEvent(client2, 'connect');
    const errorPromise = waitForEvent(client2, 'join_error');
    client2.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });

    const errorData = (await errorPromise) as { message: string };
    expect(errorData.message).toBe('Name already taken');
  });

  it('invalid join codes return an appropriate error', async () => {
    const client = createClient();
    await waitForEvent(client, 'connect');

    const errorPromise = waitForEvent(client, 'join_error');
    client.emit('join_game', { joinCode: 'XXXXXX', playerName: 'Alice' });

    const errorData = (await errorPromise) as { message: string };
    expect(errorData.message).toBe('Game not found');
  });

  it('players cannot join a game that has already started', async () => {
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    game.phase = 'night';
    store.games.set(game.id, game);

    const client = createClient();
    await waitForEvent(client, 'connect');

    const errorPromise = waitForEvent(client, 'join_error');
    client.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });

    const errorData = (await errorPromise) as { message: string };
    expect(errorData.message).toBe('Game has already started');
  });

  it('player is added to server-side game state via state machine', async () => {
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    store.games.set(game.id, game);

    const client = createClient();
    await waitForEvent(client, 'connect');

    const joinedPromise = waitForEvent(client, 'game_joined');
    client.emit('join_game', { joinCode: 'ABC123', playerName: 'Alice' });
    await joinedPromise;

    const storedGame = store.games.get('game-1')!;
    expect(storedGame.players).toHaveLength(1);
    expect(storedGame.players[0].name).toBe('Alice');
    expect(storedGame.players[0].isAlive).toBe(true);
    expect(storedGame.players[0].seatIndex).toBe(0);
  });

  it('addPlayer state machine function works correctly', () => {
    const state = createInitialGameState('game-1', 'ABC123', 'st-1');
    const player = {
      id: 'p1',
      name: 'Alice',
      trueRole: 'washerwoman' as const,
      apparentRole: 'washerwoman' as const,
      isAlive: true,
      isPoisoned: false,
      isDrunk: false,
      hasGhostVote: true,
      ghostVoteUsed: false,
      seatIndex: 0,
    };

    const newState = addPlayer(state, player);
    expect(newState.players).toHaveLength(1);
    expect(newState.players[0].name).toBe('Alice');
    // Original state should be unchanged (immutability)
    expect(state.players).toHaveLength(0);
  });
});
