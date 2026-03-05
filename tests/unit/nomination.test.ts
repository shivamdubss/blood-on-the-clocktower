import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  createInitialGameState,
  addNomination,
  clearNominations,
  transitionDaySubPhase,
  killPlayer,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState } from '../../src/types/game.js';

describe('nomination', () => {
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

    // Transition to day/dawn
    const currentGame = store.games.get('game-1')!;
    store.games.set('game-1', { ...currentGame, phase: 'night' });

    host.emit('transition_to_day', { gameId: 'game-1' });
    await waitForEvent(host, 'dawn_announcement');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Start discussion
    host.emit('start_discussion', { gameId: 'game-1' });
    await waitForEvent(host, 'discussion_started');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Open nominations (end discussion -> nomination)
    host.emit('end_discussion', { gameId: 'game-1' });
    await waitForEvent(host, 'discussion_ended');
    await new Promise<void>((r) => setTimeout(r, 50));

    return { host, players, gameId: 'game-1' };
  }

  // --- State machine unit tests ---

  it('addNomination adds a nomination to the state and logs it', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = { ...state, phase: 'day', daySubPhase: 'nomination' };

    const result = addNomination(state, 'player1', 'player2');
    expect(result.nominations).toHaveLength(1);
    expect(result.nominations[0].nominatorId).toBe('player1');
    expect(result.nominations[0].nomineeId).toBe('player2');
    expect(result.nominations[0].votes).toEqual([]);
    expect(result.nominations[0].voteCount).toBe(0);
    expect(result.nominations[0].passed).toBe(false);

    const lastLog = result.gameLog[result.gameLog.length - 1];
    expect(lastLog.type).toBe('nomination');
  });

  it('clearNominations resets the nominations array', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = addNomination(state, 'p1', 'p2');
    state = addNomination(state, 'p3', 'p4');
    expect(state.nominations).toHaveLength(2);

    const result = clearNominations(state);
    expect(result.nominations).toHaveLength(0);
  });

  it('addNomination is pure and does not mutate original state', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = { ...state, phase: 'day', daySubPhase: 'nomination' };
    const originalLength = state.nominations.length;

    addNomination(state, 'p1', 'p2');
    expect(state.nominations.length).toBe(originalLength);
  });

  // --- WebSocket integration tests ---

  it('any living player may nominate any other living player', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const game = store.games.get(gameId)!;
    const nominatorId = players[0].id!;
    const nomineeId = players[1].id!;

    const nominationPromise = waitForEvent(host, 'nomination_made');
    players[0].emit('nominate', { gameId, nomineeId });

    const result = (await nominationPromise) as { nominatorId: string; nomineeId: string; nominatorName: string; nomineeName: string };
    expect(result.nominatorId).toBe(nominatorId);
    expect(result.nomineeId).toBe(nomineeId);

    const updatedGame = store.games.get(gameId)!;
    expect(updatedGame.nominations).toHaveLength(1);
  });

  it('a player may only nominate once per day', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const game = store.games.get(gameId)!;
    const nomineeId1 = players[1].id!;
    const nomineeId2 = players[2].id!;

    // First nomination succeeds (also starts a vote)
    const nomPromise = waitForEvent(host, 'nomination_made');
    players[0].emit('nominate', { gameId, nomineeId: nomineeId1 });
    await nomPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Resolve the vote so we return to nomination phase
    const voteResultPromise = waitForEvent(host, 'vote_result');
    host.emit('reveal_votes', { gameId });
    await voteResultPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Second nomination from same player fails
    const errorPromise = waitForEvent(players[0], 'nomination_error');
    players[0].emit('nominate', { gameId, nomineeId: nomineeId2 });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('You have already nominated today');
  });

  it('a player may only be nominated once per day', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const nomineeId = players[2].id!;

    // First nomination of nominee succeeds (also starts a vote)
    const nomPromise = waitForEvent(host, 'nomination_made');
    players[0].emit('nominate', { gameId, nomineeId });
    await nomPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Resolve the vote so we return to nomination phase
    const voteResultPromise = waitForEvent(host, 'vote_result');
    host.emit('reveal_votes', { gameId });
    await voteResultPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Second nomination of same nominee from different player fails
    const errorPromise = waitForEvent(players[1], 'nomination_error');
    players[1].emit('nominate', { gameId, nomineeId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('That player has already been nominated today');
  });

  it('Storyteller can open the nomination window', async () => {
    const host = createClient();
    await waitForEvent(host, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const players: ClientSocket[] = [];
    for (let i = 0; i < 6; i++) {
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

    // Open nominations
    const openedPromise = waitForEvent(players[0], 'nominations_opened');
    host.emit('open_nominations', { gameId: 'game-1' });

    const result = (await openedPromise) as { dayNumber: number };
    expect(result.dayNumber).toBe(1);

    const updatedGame = store.games.get('game-1')!;
    expect(updatedGame.daySubPhase).toBe('nomination');
  });

  it('Storyteller can close the nomination window', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const closedPromise = waitForEvent(players[0], 'nominations_closed');
    host.emit('close_nominations', { gameId });

    const result = (await closedPromise) as { dayNumber: number };
    expect(result.dayNumber).toBe(1);

    const updatedGame = store.games.get(gameId)!;
    expect(updatedGame.daySubPhase).toBe('end');
  });

  it('dead players cannot nominate', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Kill a player
    const game = store.games.get(gameId)!;
    const deadPlayerId = players[0].id!;
    const updatedGame = killPlayer(game, deadPlayerId);
    store.games.set(gameId, updatedGame);

    // Dead player tries to nominate
    const errorPromise = waitForEvent(players[0], 'nomination_error');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Dead players cannot nominate');
  });

  it('cannot nominate a dead player', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Kill the nominee
    const game = store.games.get(gameId)!;
    const deadPlayerId = players[1].id!;
    const updatedGame = killPlayer(game, deadPlayerId);
    store.games.set(gameId, updatedGame);

    // Try to nominate the dead player
    const errorPromise = waitForEvent(players[0], 'nomination_error');
    players[0].emit('nominate', { gameId, nomineeId: deadPlayerId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Cannot nominate a dead player');
  });

  it('cannot nominate when nominations are not open', async () => {
    const host = createClient();
    await waitForEvent(host, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const players: ClientSocket[] = [];
    for (let i = 0; i < 6; i++) {
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

    // We're in setup phase, not nomination
    const errorPromise = waitForEvent(players[0], 'nomination_error');
    players[0].emit('nominate', { gameId: 'game-1', nomineeId: players[1].id! });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Nominations are not open');
  });

  it('only the Storyteller can open nominations', async () => {
    const host = createClient();
    await waitForEvent(host, 'connect');

    const game = createInitialGameState('game-1', 'ABC123', host.id!);
    store.games.set(game.id, game);

    host.emit('join_game', { joinCode: 'ABC123', playerName: 'Host' });
    await waitForEvent(host, 'game_joined');
    await new Promise<void>((r) => setTimeout(r, 50));

    const players: ClientSocket[] = [];
    for (let i = 0; i < 6; i++) {
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
    store.games.set('game-1', { ...currentGame, phase: 'day', daySubPhase: 'discussion' });

    const errorPromise = waitForEvent(players[0], 'nomination_error');
    players[0].emit('open_nominations', { gameId: 'game-1' });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Only the Storyteller can open nominations');
  });

  it('only the Storyteller can close nominations', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const errorPromise = waitForEvent(players[0], 'nomination_error');
    players[0].emit('close_nominations', { gameId });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Only the Storyteller can close nominations');
  });

  it('all clients receive nomination_made simultaneously', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const nomineeId = players[2].id!;
    const promises = [host, ...players].map((c) => waitForEvent(c, 'nomination_made'));
    players[0].emit('nominate', { gameId, nomineeId });

    const results = await Promise.all(promises);
    for (const result of results) {
      const r = result as { nomineeId: string };
      expect(r.nomineeId).toBe(nomineeId);
    }
  });

  it('cannot nominate yourself', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const errorPromise = waitForEvent(players[0], 'nomination_error');
    players[0].emit('nominate', { gameId, nomineeId: players[0].id! });

    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('You cannot nominate yourself');
  });
});
