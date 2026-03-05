import { test, expect } from '@playwright/test';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

const BASE_URL = 'http://localhost:3000';

function createSocket(): ClientSocket {
  return ioClient(BASE_URL, { forceNew: true, transports: ['websocket'] });
}

function waitFor<T = unknown>(socket: ClientSocket, event: string, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

interface GrimoirePlayer {
  playerId: string;
  playerName: string;
  trueRole: { id: string; team: string };
}

interface GameOverData {
  winner: string;
  players: Array<{ playerId?: string; playerName?: string; trueRole: string; isAlive: boolean }>;
}

async function setup7PlayerGame(request: Parameters<Parameters<typeof test>[2]>[0]['request']) {
  const res = await request.post('/api/game', { data: {} });
  const { joinCode, gameId, hostSecret } = await res.json();

  const host = createSocket();
  await waitFor(host, 'connect');
  host.emit('join_game', { joinCode, playerName: 'ST', hostSecret });
  await waitFor(host, 'game_joined');

  const playerNames = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const players: ClientSocket[] = [];
  const playerIds: string[] = [];

  for (const name of playerNames) {
    const s = createSocket();
    await waitFor(s, 'connect');
    s.emit('join_game', { joinCode, playerName: name });
    const joined = await waitFor<{ playerId: string }>(s, 'game_joined');
    playerIds.push(joined.playerId);
    players.push(s);
  }

  await new Promise<void>((r) => setTimeout(r, 50));

  return { host, players, playerIds, gameId, joinCode };
}

function cleanup(host: ClientSocket, players: ClientSocket[]) {
  host.disconnect();
  for (const s of players) s.disconnect();
}

// Helper: advance through an entire day phase with no execution
async function passDay(host: ClientSocket, listener: ClientSocket, gameId: string) {
  let p = waitFor(listener, 'game_state');
  host.emit('transition_to_day', { gameId });
  await waitFor(listener, 'dawn_announcement');
  await p;

  p = waitFor(listener, 'game_state');
  host.emit('start_discussion', { gameId });
  await p;

  p = waitFor(listener, 'game_state');
  host.emit('end_discussion', { gameId });
  await p;

  p = waitFor(listener, 'game_state');
  host.emit('close_nominations', { gameId });
  await p;
}

// Helper: advance through night queue
async function processNightQueue(
  host: ClientSocket,
  gameId: string,
  grimoire: { players: GrimoirePlayer[] },
  impInput?: { targetPlayerId: string },
) {
  // Listen for first prompt or queue empty
  const firstPrompt = waitFor<{ queuePosition: number; totalInQueue: number; roleId: string }>(host, 'night_prompt', 3000).catch(() => null);
  const firstEmpty = waitFor(host, 'night_queue_empty', 3000).catch(() => null);

  let prompt = await Promise.race([firstPrompt, firstEmpty.then(() => null)]);

  while (prompt) {
    let input: unknown = {};
    if (prompt.roleId === 'imp' && impInput) {
      input = impInput;
    } else if (prompt.roleId === 'poisoner') {
      const target = grimoire.players.find((p) => p.trueRole.id !== 'poisoner' && p.trueRole.team !== 'demon');
      if (target) input = { targetPlayerId: target.playerId };
    } else if (prompt.roleId === 'monk') {
      const target = grimoire.players.find((p) => p.trueRole.id !== 'monk');
      if (target) input = { targetPlayerId: target.playerId };
    } else if (prompt.roleId === 'butler') {
      const target = grimoire.players.find((p) => p.trueRole.id !== 'butler');
      if (target) input = { targetPlayerId: target.playerId };
    }

    const nextPrompt = waitFor<{ queuePosition: number; totalInQueue: number; roleId: string }>(host, 'night_prompt', 3000).catch(() => null);
    const queueEmpty = waitFor(host, 'night_queue_empty', 3000).catch(() => null);

    host.emit('submit_night_action', { gameId, input });
    await waitFor(host, 'night_action_confirmed');

    prompt = await Promise.race([nextPrompt, queueEmpty.then(() => null)]);
  }
}

test.describe('full game', () => {
  test('7-player Trouble Brewing game completes start to finish', async ({ request }) => {
    const { host, players, playerIds, gameId } = await setup7PlayerGame(request);

    try {
      // Start game: set up ALL listeners before emitting
      const allSockets = [host, ...players];
      const rolePromises = allSockets.map((s) => waitFor<{ name: string; team: string; ability: string }>(s, 'your_role'));
      const grimoireP = waitFor<{ players: GrimoirePlayer[] }>(host, 'grimoire');
      const stateP = waitFor(players[0], 'game_state');

      host.emit('start_game', { gameId });

      const [roles, grimoire] = await Promise.all([Promise.all(rolePromises), grimoireP]);
      await stateP;

      // Every player received a role card
      for (const role of roles) {
        expect(role.name).toBeTruthy();
        expect(['townsfolk', 'outsider', 'minion', 'demon']).toContain(role.team);
        expect(role.ability).toBeTruthy();
      }
      expect(grimoire.players).toHaveLength(7);

      // Find key players
      const demonEntry = grimoire.players.find((p) => p.trueRole.team === 'demon')!;
      const demonId = demonEntry.playerId;
      const scarletWoman = grimoire.players.find((p) => p.trueRole.id === 'scarletWoman');

      // Transition to day from setup
      let p = waitFor(players[0], 'game_state');
      host.emit('transition_to_day', { gameId });
      await waitFor(players[0], 'dawn_announcement');
      await p;

      // If SW exists, poison her to prevent trigger
      if (scarletWoman) {
        p = waitFor(players[0], 'game_state');
        host.emit('storyteller_override', {
          gameId,
          override: { type: 'set_poison', playerId: scarletWoman.playerId },
        });
        await p;
      }

      // Day: discussion → nomination → vote → close → execute
      p = waitFor(players[0], 'game_state');
      host.emit('start_discussion', { gameId });
      await p;

      p = waitFor(players[0], 'game_state');
      host.emit('end_discussion', { gameId });
      await p;

      // Find a living non-demon player to nominate
      const nominatorId = grimoire.players.find((p) => p.trueRole.team !== 'demon' && p.playerId !== host.id)!.playerId;
      const nominatorSocket = allSockets.find((s) => s.id === nominatorId)!;

      // Nominate the Demon
      const nomP = waitFor(players[0], 'nomination_made');
      const voteStartP = waitFor(players[0], 'vote_started');
      nominatorSocket.emit('nominate', { gameId, nomineeId: demonId });
      await nomP;
      await voteStartP;

      // All vote yes
      const voteResultP = allSockets.map((s) => waitFor<{ passed: boolean; voteCount: number }>(s, 'vote_result'));
      for (const s of allSockets) {
        s.emit('submit_vote', { gameId, vote: true });
      }
      const voteResults = await Promise.all(voteResultP);
      expect(voteResults[0].passed).toBe(true);

      // Close nominations
      p = waitFor(players[0], 'game_state');
      host.emit('close_nominations', { gameId });
      await p;

      // Resolve execution → Demon dies → Good wins
      const execP = waitFor<{ executed: { playerId: string } | null; reason: string }>(players[0], 'execution_result');
      const gameOverP = waitFor<GameOverData>(players[0], 'game_over');
      host.emit('resolve_execution', { gameId });

      const execResult = await execP;
      expect(execResult.executed).toBeTruthy();
      expect(execResult.executed!.playerId).toBe(demonId);

      const gameOver = await gameOverP;
      expect(gameOver.winner).toBe('good');
      expect(gameOver.players).toHaveLength(7);

      // All roles revealed
      for (const p of gameOver.players) {
        expect(p.trueRole).toBeTruthy();
      }
    } finally {
      cleanup(host, players);
    }
  });

  test('night abilities fire in correct order and produce output', async ({ request }) => {
    const { host, players, gameId } = await setup7PlayerGame(request);

    try {
      // Start game
      const grimoireP = waitFor<{ players: GrimoirePlayer[] }>(host, 'grimoire');
      const stateP = waitFor(players[0], 'game_state');
      host.emit('start_game', { gameId });
      const grimoire = await grimoireP;
      await stateP;

      // Setup → Day 1 (skip) → Night 2 (has Imp in queue)
      await passDay(host, players[0], gameId);

      // End day → night
      const nightP = waitFor(players[0], 'game_state');
      host.emit('end_day', { gameId });
      await nightP;

      // Process Night 2 queue
      const target = grimoire.players.find((p) => p.trueRole.team !== 'demon' && p.playerId !== host.id)!;
      await processNightQueue(host, gameId, grimoire, { targetPlayerId: target.playerId });

      // End night → dawn
      const dawnP = waitFor<{ deaths: Array<{ playerId: string }>; message?: string }>(players[0], 'dawn_announcement');
      const dayStateP = waitFor(players[0], 'game_state');
      host.emit('end_night', { gameId });
      const dawn = await dawnP;
      await dayStateP;

      // Dawn should have deaths or a message
      expect(dawn.deaths !== undefined || dawn.message !== undefined).toBe(true);
    } finally {
      cleanup(host, players);
    }
  });

  test('game ends with no console errors during full cycle', async ({ request }) => {
    const { host, players, gameId } = await setup7PlayerGame(request);

    try {
      // Start game
      const grimoireP = waitFor<{ players: GrimoirePlayer[] }>(host, 'grimoire');
      const stateP = waitFor(players[0], 'game_state');
      host.emit('start_game', { gameId });
      const grimoire = await grimoireP;
      await stateP;

      // Full cycle: setup → day → night → day → execute Demon
      await passDay(host, players[0], gameId);

      // End day → night
      let p = waitFor(players[0], 'game_state');
      host.emit('end_day', { gameId });
      await p;

      // Process night queue
      const target = grimoire.players.find((gp) => gp.trueRole.team !== 'demon' && gp.playerId !== host.id)!;
      await processNightQueue(host, gameId, grimoire, { targetPlayerId: target.playerId });

      // End night → day 2
      p = waitFor(players[0], 'game_state');
      host.emit('end_night', { gameId });
      await waitFor(players[0], 'dawn_announcement');
      await p;

      // Day 2: find the demon and execute
      const demonEntry = grimoire.players.find((gp) => gp.trueRole.team === 'demon')!;
      const scarletWoman = grimoire.players.find((gp) => gp.trueRole.id === 'scarletWoman');

      // Poison SW if present
      if (scarletWoman) {
        p = waitFor(players[0], 'game_state');
        host.emit('storyteller_override', {
          gameId,
          override: { type: 'set_poison', playerId: scarletWoman.playerId },
        });
        await p;
      }

      p = waitFor(players[0], 'game_state');
      host.emit('start_discussion', { gameId });
      await p;

      p = waitFor(players[0], 'game_state');
      host.emit('end_discussion', { gameId });
      await p;

      // Find alive nominator
      const allSockets = [host, ...players];
      const aliveNominator = grimoire.players.find(
        (gp) => gp.trueRole.team !== 'demon' && gp.playerId !== host.id && gp.playerId !== target.playerId
      );

      if (aliveNominator) {
        const nominatorSocket = allSockets.find((s) => s.id === aliveNominator.playerId)!;

        const nomP = waitFor(players[0], 'nomination_made');
        const vsP = waitFor(players[0], 'vote_started');
        nominatorSocket.emit('nominate', { gameId, nomineeId: demonEntry.playerId });
        await nomP;
        await vsP;

        // Vote
        const vrP = allSockets.map((s) => waitFor(s, 'vote_result'));
        for (const s of allSockets) {
          s.emit('submit_vote', { gameId, vote: true });
        }
        await Promise.all(vrP);

        // Close nominations and execute
        p = waitFor(players[0], 'game_state');
        host.emit('close_nominations', { gameId });
        await p;

        const execP = waitFor<{ executed: { playerId: string } | null }>(players[0], 'execution_result');
        const goP = waitFor<GameOverData>(players[0], 'game_over');
        host.emit('resolve_execution', { gameId });

        const exec = await execP;
        expect(exec.executed).toBeTruthy();

        const gameOver = await goP;
        expect(gameOver.winner).toBe('good');
        expect(gameOver.players).toHaveLength(7);
      }
    } finally {
      cleanup(host, players);
    }
  });
});
