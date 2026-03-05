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
  killPlayer,
} from '../../src/server/gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from '../../src/server/socketHandlers.js';
import type { GameState, Player } from '../../src/types/game.js';

describe('voting', () => {
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

    // Neutralize Virgin ability to prevent random interference with voting tests
    const currentGame = store.games.get('game-1')!;
    store.games.set('game-1', { ...currentGame, phase: 'night', virginAbilityUsed: true });

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

  // --- State machine unit tests ---

  it('startVote sets activeNominationIndex and daySubPhase to vote', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = { ...state, phase: 'day', daySubPhase: 'nomination' };
    state = addNomination(state, 'p1', 'p2');

    const result = startVote(state, 0);
    expect(result.activeNominationIndex).toBe(0);
    expect(result.daySubPhase).toBe('vote');
    expect(result.gameLog[result.gameLog.length - 1].type).toBe('vote_started');
  });

  it('recordVote adds a yes vote to the nomination', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = {
      ...state,
      phase: 'day',
      daySubPhase: 'vote',
      players: [
        { id: 'p1', name: 'A', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0 },
        { id: 'p2', name: 'B', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 1 },
      ],
    };
    state = addNomination(state, 'p1', 'p2');
    state = startVote(state, 0);

    const result = recordVote(state, 0, 'p1', true);
    expect(result.nominations[0].votes).toContain('p1');
    expect(result.nominations[0].votesSubmitted).toContain('p1');
  });

  it('recordVote records a no vote (submitted but not in votes)', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = {
      ...state,
      phase: 'day',
      daySubPhase: 'vote',
      players: [
        { id: 'p1', name: 'A', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0 },
        { id: 'p2', name: 'B', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 1 },
      ],
    };
    state = addNomination(state, 'p1', 'p2');
    state = startVote(state, 0);

    const result = recordVote(state, 0, 'p1', false);
    expect(result.nominations[0].votes).not.toContain('p1');
    expect(result.nominations[0].votesSubmitted).toContain('p1');
  });

  it('recordVote prevents double voting', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    state = {
      ...state,
      phase: 'day',
      daySubPhase: 'vote',
      players: [
        { id: 'p1', name: 'A', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0 },
        { id: 'p2', name: 'B', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 1 },
      ],
    };
    state = addNomination(state, 'p1', 'p2');
    state = startVote(state, 0);
    state = recordVote(state, 0, 'p1', true);

    const result = recordVote(state, 0, 'p1', true);
    // Should be unchanged - still only 1 vote
    expect(result.nominations[0].votes).toHaveLength(1);
    expect(result.nominations[0].votesSubmitted).toHaveLength(1);
  });

  it('resolveVote calculates pass/fail correctly with threshold', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    const players: Player[] = [];
    for (let i = 0; i < 7; i++) {
      players.push({
        id: `p${i}`, name: `P${i}`, trueRole: 'washerwoman', apparentRole: 'washerwoman',
        isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: i,
      });
    }
    state = { ...state, players, phase: 'day', daySubPhase: 'vote' };
    state = addNomination(state, 'p0', 'p1');
    state = startVote(state, 0);

    // 4 yes votes out of 7 living players; threshold = ceil(7/2) = 4
    state = recordVote(state, 0, 'p0', true);
    state = recordVote(state, 0, 'p1', true);
    state = recordVote(state, 0, 'p2', true);
    state = recordVote(state, 0, 'p3', true);

    const result = resolveVote(state, 0);
    expect(result.nominations[0].voteCount).toBe(4);
    expect(result.nominations[0].passed).toBe(true);
    expect(result.activeNominationIndex).toBeNull();
    expect(result.daySubPhase).toBe('nomination');
  });

  it('resolveVote fails when votes below threshold', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    const players: Player[] = [];
    for (let i = 0; i < 7; i++) {
      players.push({
        id: `p${i}`, name: `P${i}`, trueRole: 'washerwoman', apparentRole: 'washerwoman',
        isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: i,
      });
    }
    state = { ...state, players, phase: 'day', daySubPhase: 'vote' };
    state = addNomination(state, 'p0', 'p1');
    state = startVote(state, 0);

    // 3 yes votes out of 7 living; threshold = 4
    state = recordVote(state, 0, 'p0', true);
    state = recordVote(state, 0, 'p1', true);
    state = recordVote(state, 0, 'p2', true);

    const result = resolveVote(state, 0);
    expect(result.nominations[0].voteCount).toBe(3);
    expect(result.nominations[0].passed).toBe(false);
  });

  it('ghost vote: dead player can use their one ghost vote', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    const players: Player[] = [
      { id: 'p0', name: 'P0', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: false, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0 },
      { id: 'p1', name: 'P1', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 1 },
    ];
    state = { ...state, players, phase: 'day', daySubPhase: 'vote' };
    state = addNomination(state, 'p1', 'p0');
    state = startVote(state, 0);

    const result = recordVote(state, 0, 'p0', true);
    expect(result.nominations[0].votes).toContain('p0');
    // Ghost vote should be marked as used
    const deadPlayer = result.players.find((p) => p.id === 'p0')!;
    expect(deadPlayer.ghostVoteUsed).toBe(true);
    expect(deadPlayer.hasGhostVote).toBe(false);
  });

  it('ghost vote: dead player cannot vote yes after ghost vote is used', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    const players: Player[] = [
      { id: 'p0', name: 'P0', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: false, isPoisoned: false, isDrunk: false, hasGhostVote: false, ghostVoteUsed: true, seatIndex: 0 },
      { id: 'p1', name: 'P1', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 1 },
      { id: 'p2', name: 'P2', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 2 },
    ];
    state = { ...state, players, phase: 'day', daySubPhase: 'vote' };
    state = addNomination(state, 'p1', 'p2');
    state = startVote(state, 0);

    // Dead player with used ghost vote tries to vote yes
    const result = recordVote(state, 0, 'p0', true);
    expect(result.nominations[0].votes).not.toContain('p0');
    expect(result.nominations[0].votesSubmitted).not.toContain('p0');
  });

  it('ghost vote usage is tracked and persists across nominations', () => {
    let state = createInitialGameState('g1', 'ABC', 'st1');
    const players: Player[] = [
      { id: 'p0', name: 'P0', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: false, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0 },
      { id: 'p1', name: 'P1', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 1 },
      { id: 'p2', name: 'P2', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 2 },
      { id: 'p3', name: 'P3', trueRole: 'washerwoman', apparentRole: 'washerwoman', isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 3 },
    ];
    state = { ...state, players, phase: 'day', daySubPhase: 'vote' };

    // First nomination: dead player uses ghost vote
    state = addNomination(state, 'p1', 'p2');
    state = startVote(state, 0);
    state = recordVote(state, 0, 'p0', true);
    state = resolveVote(state, 0);

    // Verify ghost vote was used
    expect(state.players.find((p) => p.id === 'p0')!.ghostVoteUsed).toBe(true);

    // Second nomination: dead player cannot vote yes again
    state = addNomination(state, 'p2', 'p3');
    state = startVote(state, 1);
    const result = recordVote(state, 1, 'p0', true);
    expect(result.nominations[1].votes).not.toContain('p0');
  });

  // --- WebSocket integration tests ---

  it('each nomination triggers a vote immediately', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    const voteStartedPromise = waitForEvent(players[0], 'vote_started');
    players[1].emit('nominate', { gameId, nomineeId: players[2].id! });

    const result = (await voteStartedPromise) as { nominationIndex: number; nomineeId: string };
    expect(result.nominationIndex).toBe(0);
    expect(result.nomineeId).toBe(players[2].id!);

    const game = store.games.get(gameId)!;
    expect(game.daySubPhase).toBe('vote');
    expect(game.activeNominationIndex).toBe(0);
  });

  it('living players can vote by submitting a vote', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Create nomination to start vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Submit a vote
    const voteRecordedPromise = waitForEvent(players[2], 'vote_recorded');
    players[2].emit('submit_vote', { gameId, vote: true });

    const result = (await voteRecordedPromise) as { playerId: string; vote: boolean };
    expect(result.vote).toBe(true);
  });

  it('votes are locked in simultaneously - results revealed only after all submit or storyteller reveals', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Submit some votes (not all)
    players[0].emit('submit_vote', { gameId, vote: true });
    await waitForEvent(players[0], 'vote_recorded');
    players[1].emit('submit_vote', { gameId, vote: false });
    await waitForEvent(players[1], 'vote_recorded');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Vote should still be in progress (not all submitted)
    const game = store.games.get(gameId)!;
    expect(game.daySubPhase).toBe('vote');

    // Storyteller reveals votes early
    const voteResultPromise = waitForEvent(players[0], 'vote_result');
    host.emit('reveal_votes', { gameId });

    const result = (await voteResultPromise) as { voteCount: number; passed: boolean };
    expect(typeof result.voteCount).toBe('number');
    expect(typeof result.passed).toBe('boolean');

    // Should be back in nomination phase
    const updatedGame = store.games.get(gameId)!;
    expect(updatedGame.daySubPhase).toBe('nomination');
  });

  it('vote results are revealed to all players at once', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Set up listeners for vote_result on all clients
    const resultPromises = [host, ...players].map((c) => waitForEvent(c, 'vote_result'));

    // Storyteller reveals votes
    host.emit('reveal_votes', { gameId });

    const results = await Promise.all(resultPromises);
    for (const result of results) {
      const r = result as { voteCount: number; passed: boolean; threshold: number };
      expect(typeof r.voteCount).toBe('number');
      expect(typeof r.passed).toBe('boolean');
      expect(typeof r.threshold).toBe('number');
    }
  });

  it('a nomination passes if the vote count exceeds half of living players (rounded up)', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // All 7 players: threshold = ceil(7/2) = 4
    // Submit 4 yes votes
    for (let i = 0; i < 4; i++) {
      players[i].emit('submit_vote', { gameId, vote: true });
      await waitForEvent(players[i], 'vote_recorded');
    }
    await new Promise<void>((r) => setTimeout(r, 50));

    // Storyteller reveals
    const resultPromise = waitForEvent(host, 'vote_result');
    host.emit('reveal_votes', { gameId });
    const result = (await resultPromise) as { voteCount: number; passed: boolean; threshold: number };

    expect(result.voteCount).toBe(4);
    expect(result.threshold).toBe(4);
    expect(result.passed).toBe(true);
  });

  it('a nomination fails if votes are below threshold', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Submit 3 yes votes (threshold = 4)
    for (let i = 0; i < 3; i++) {
      players[i].emit('submit_vote', { gameId, vote: true });
      await waitForEvent(players[i], 'vote_recorded');
    }
    await new Promise<void>((r) => setTimeout(r, 50));

    // Storyteller reveals
    const resultPromise = waitForEvent(host, 'vote_result');
    host.emit('reveal_votes', { gameId });
    const result = (await resultPromise) as { voteCount: number; passed: boolean };

    expect(result.voteCount).toBe(3);
    expect(result.passed).toBe(false);
  });

  it('dead players have exactly one ghost vote for the entire game', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Kill a player
    const game = store.games.get(gameId)!;
    const deadPlayerId = players[3].id!;
    store.games.set(gameId, killPlayer(game, deadPlayerId));

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Dead player uses ghost vote
    const voteRecordedPromise = waitForEvent(players[3], 'vote_recorded');
    players[3].emit('submit_vote', { gameId, vote: true });
    await voteRecordedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Verify ghost vote was recorded
    const updatedGame = store.games.get(gameId)!;
    const deadPlayer = updatedGame.players.find((p) => p.id === deadPlayerId)!;
    expect(deadPlayer.ghostVoteUsed).toBe(true);
    expect(deadPlayer.hasGhostVote).toBe(false);

    // Resolve this vote and start another
    host.emit('reveal_votes', { gameId });
    await waitForEvent(host, 'vote_result');
    await new Promise<void>((r) => setTimeout(r, 50));

    // New nomination and vote
    const voteStarted2 = waitForEvent(host, 'vote_started');
    players[2].emit('nominate', { gameId, nomineeId: players[4].id! });
    await voteStarted2;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Dead player tries to vote again
    const errorPromise = waitForEvent(players[3], 'vote_error');
    players[3].emit('submit_vote', { gameId, vote: true });
    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('You have already used your ghost vote');
  });

  it('ghost vote usage is tracked and enforced server-side', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Kill a player and mark ghost vote as already used
    const game = store.games.get(gameId)!;
    const deadPlayerId = players[3].id!;
    let updatedGame = killPlayer(game, deadPlayerId);
    updatedGame = {
      ...updatedGame,
      players: updatedGame.players.map((p) =>
        p.id === deadPlayerId ? { ...p, ghostVoteUsed: true, hasGhostVote: false } : p
      ),
    };
    store.games.set(gameId, updatedGame);

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Dead player with used ghost vote tries to vote yes
    const errorPromise = waitForEvent(players[3], 'vote_error');
    players[3].emit('submit_vote', { gameId, vote: true });
    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('You have already used your ghost vote');
  });

  it('cannot vote when no vote is in progress', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // We're in nomination phase, not vote phase
    const errorPromise = waitForEvent(players[0], 'vote_error');
    players[0].emit('submit_vote', { gameId, vote: true });
    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('No vote is currently in progress');
  });

  it('cannot vote twice on the same nomination', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Submit first vote
    players[2].emit('submit_vote', { gameId, vote: true });
    await waitForEvent(players[2], 'vote_recorded');
    await new Promise<void>((r) => setTimeout(r, 50));

    // Try to vote again
    const errorPromise = waitForEvent(players[2], 'vote_error');
    players[2].emit('submit_vote', { gameId, vote: false });
    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('You have already voted');
  });

  it('only the Storyteller can reveal votes early', async () => {
    const { host, players, gameId } = await setupGameInNomination(7);

    // Nomination -> vote
    const voteStartedPromise = waitForEvent(host, 'vote_started');
    players[0].emit('nominate', { gameId, nomineeId: players[1].id! });
    await voteStartedPromise;
    await new Promise<void>((r) => setTimeout(r, 50));

    // Non-storyteller tries to reveal
    const errorPromise = waitForEvent(players[0], 'vote_error');
    players[0].emit('reveal_votes', { gameId });
    const error = (await errorPromise) as { message: string };
    expect(error.message).toBe('Only the Storyteller can reveal votes');
  });
});
