import { test, expect } from '@playwright/test';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

const BASE_URL = 'http://localhost:3000';

function createSocket(): ClientSocket {
  return ioClient(BASE_URL, { forceNew: true, transports: ['websocket'] });
}

function waitFor(socket: ClientSocket, event: string, timeout = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function createGameAndJoinPlayers(request: ReturnType<typeof test['info']>['fixme'] extends never ? never : never, count: number) {
  // This helper is replaced inline in tests since `request` typing is complex
}

test.describe('player UI', () => {
  test('player receives role card with name, team, and ability after game starts', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host', hostSecret });
    await waitFor(host, 'game_joined');

    const players: ClientSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `Player${i}` });
      await waitFor(s, 'game_joined');
      players.push(s);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // All players listen for role cards
    const rolePromises = [host, ...players].map((s) => waitFor(s, 'your_role'));

    host.emit('start_game', { gameId });

    const roles = await Promise.all(rolePromises);

    // Each player receives a role card with name, team, and ability
    for (const role of roles) {
      const r = role as { role: string; name: string; team: string; ability: string };
      expect(r.name).toBeTruthy();
      expect(typeof r.name).toBe('string');
      expect(['townsfolk', 'outsider', 'minion', 'demon']).toContain(r.team);
      expect(r.ability).toBeTruthy();
      expect(typeof r.ability).toBe('string');
    }

    host.disconnect();
    for (const s of players) s.disconnect();
  });

  test('day/night phase transitions are indicated via game_state', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host', hostSecret });
    await waitFor(host, 'game_joined');

    const players: ClientSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `Player${i}` });
      await waitFor(s, 'game_joined');
      players.push(s);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // Start game → setup phase
    const setupState = waitFor(players[0], 'game_state');
    const hostSetupState = waitFor(host, 'game_state');
    host.emit('start_game', { gameId });
    const state1 = (await setupState) as { phase: string };
    expect(state1.phase).toBe('setup');

    // Transition to day
    const dayState = waitFor(players[0], 'game_state');
    host.emit('transition_to_day', { gameId });
    const state2 = (await dayState) as { phase: string; daySubPhase: string };
    expect(state2.phase).toBe('day');
    expect(state2.daySubPhase).toBe('dawn');

    // Start discussion
    const discState = waitFor(players[0], 'game_state');
    host.emit('start_discussion', { gameId });
    const state3 = (await discState) as { phase: string; daySubPhase: string };
    expect(state3.phase).toBe('day');
    expect(state3.daySubPhase).toBe('discussion');

    // Close nominations
    const nomState = waitFor(players[0], 'game_state');
    host.emit('end_discussion', { gameId });
    const state4 = (await nomState) as { phase: string; daySubPhase: string };
    expect(state4.daySubPhase).toBe('nomination');

    // Close nominations and end day → night
    const closeState = waitFor(players[0], 'game_state');
    host.emit('close_nominations', { gameId });
    await closeState;

    const nightState = waitFor(players[0], 'game_state');
    host.emit('end_day', { gameId });
    const state5 = (await nightState) as { phase: string };
    expect(state5.phase).toBe('night');

    host.disconnect();
    for (const s of players) s.disconnect();
  });

  test('vote UI flow: nomination, voting, and result reveal', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host', hostSecret });
    const hostJoin = (await waitFor(host, 'game_joined')) as { playerId: string };

    const sockets: ClientSocket[] = [];
    const playerIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `P${i}` });
      const joined = (await waitFor(s, 'game_joined')) as { playerId: string };
      sockets.push(s);
      playerIds.push(joined.playerId);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // Start game and transition to day/nomination
    const allSockets = [host, ...sockets];
    const startPromises = allSockets.map((s) => waitFor(s, 'game_state'));
    host.emit('start_game', { gameId });
    await Promise.all(startPromises);

    host.emit('transition_to_day', { gameId });
    await waitFor(sockets[0], 'game_state');

    host.emit('start_discussion', { gameId });
    await waitFor(sockets[0], 'game_state');

    host.emit('end_discussion', { gameId });
    await waitFor(sockets[0], 'game_state');

    // Player 0 nominates Player 1
    const nomPromise = waitFor(sockets[0], 'nomination_made');
    const votePromise = waitFor(sockets[0], 'vote_started');
    sockets[0].emit('nominate', { gameId, nomineeId: playerIds[1] });

    const nom = (await nomPromise) as { nominatorName: string; nomineeName: string };
    expect(nom.nominatorName).toBe('P0');
    expect(nom.nomineeName).toBe('P1');

    const vote = (await votePromise) as { nomineeName: string; nominatorName: string };
    expect(vote.nomineeName).toBe('P1');

    // All players vote
    const resultPromises = allSockets.map((s) => waitFor(s, 'vote_result'));
    for (const s of allSockets) {
      s.emit('submit_vote', { gameId, vote: true });
    }

    const results = await Promise.all(resultPromises);
    const result = results[0] as { voteCount: number; passed: boolean; threshold: number };
    expect(result.voteCount).toBe(5);
    expect(result.passed).toBe(true);
    expect(result.threshold).toBeGreaterThan(0);

    host.disconnect();
    for (const s of sockets) s.disconnect();
  });

  test('dead players are marked in game state', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host', hostSecret });
    await waitFor(host, 'game_joined');

    const sockets: ClientSocket[] = [];
    const playerIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `P${i}` });
      const joined = (await waitFor(s, 'game_joined')) as { playerId: string };
      sockets.push(s);
      playerIds.push(joined.playerId);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // Start game - consume the game_state from start_game on both listening sockets
    const startStatePromises = sockets.map((s) => waitFor(s, 'game_state'));
    host.emit('start_game', { gameId });
    await Promise.all(startStatePromises);

    // Now listen for the override-triggered game_state
    const overrideStatePromise = waitFor(sockets[1], 'game_state');

    // Use storyteller_override to kill a player
    host.emit('storyteller_override', {
      gameId,
      override: { type: 'kill_player', playerId: playerIds[0] },
    });

    const updatedState = (await overrideStatePromise) as {
      players: Array<{ id: string; isAlive: boolean }>;
    };

    const deadPlayer = updatedState.players.find((p) => p.id === playerIds[0]);
    expect(deadPlayer).toBeDefined();
    expect(deadPlayer!.isAlive).toBe(false);

    // Living players remain alive
    const alivePlayer = updatedState.players.find((p) => p.id === playerIds[1]);
    expect(alivePlayer).toBeDefined();
    expect(alivePlayer!.isAlive).toBe(true);

    host.disconnect();
    for (const s of sockets) s.disconnect();
  });

  test('player cannot see other players roles in game state', async ({ request }) => {
    const res = await request.post('/api/game', { data: {} });
    const { joinCode, gameId, hostSecret } = await res.json();

    const host = createSocket();
    await waitFor(host, 'connect');
    host.emit('join_game', { joinCode, playerName: 'Host', hostSecret });
    await waitFor(host, 'game_joined');

    const players: ClientSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const s = createSocket();
      await waitFor(s, 'connect');
      s.emit('join_game', { joinCode, playerName: `P${i}` });
      await waitFor(s, 'game_joined');
      players.push(s);
    }

    await new Promise<void>((r) => setTimeout(r, 50));

    // Non-host player listens for game_state after start
    const statePromise = waitFor(players[0], 'game_state');
    host.emit('start_game', { gameId });
    const state = (await statePromise) as {
      players: Array<{ trueRole: string; apparentRole: string; isPoisoned: boolean; isDrunk: boolean }>;
    };

    // All roles should be sanitized (no real role info visible)
    for (const p of state.players) {
      expect(p.trueRole).toBe('washerwoman');
      expect(p.apparentRole).toBe('washerwoman');
      expect(p.isPoisoned).toBe(false);
      expect(p.isDrunk).toBe(false);
    }

    host.disconnect();
    for (const s of players) s.disconnect();
  });
});
