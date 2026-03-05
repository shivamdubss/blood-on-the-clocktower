import type { Server, Socket } from 'socket.io';
import type { GameState, Player } from '../types/game.js';
import { addPlayer, removePlayer, transitionPhase, setStoryteller, assignAllRoles, resolveDawnDeaths, transitionDaySubPhase, addNomination, clearNominations } from './gameStateMachine.js';
import { ROLE_MAP } from '../data/roles.js';

export interface GameStore {
  games: Map<string, GameState>;
}

function findGameByJoinCode(store: GameStore, joinCode: string): GameState | undefined {
  return Array.from(store.games.values()).find((g) => g.joinCode === joinCode);
}

function findGameByPlayerId(store: GameStore, playerId: string): GameState | undefined {
  return Array.from(store.games.values()).find((g) =>
    g.players.some((p) => p.id === playerId)
  );
}

function sanitizeGameStateForPlayer(state: GameState): GameState {
  return {
    ...state,
    hostSecret: '',
    demonBluffRoles: [],
    players: state.players.map((p) => ({
      ...p,
      trueRole: 'washerwoman' as const,
      apparentRole: 'washerwoman' as const,
      isPoisoned: false,
      isDrunk: false,
    })),
  };
}

export function registerSocketHandlers(io: Server, store: GameStore): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join_game', (data: { joinCode: string; playerName: string; hostSecret?: string }) => {
      const { joinCode, playerName, hostSecret } = data;
      const game = findGameByJoinCode(store, joinCode);

      if (!game) {
        socket.emit('join_error', { message: 'Game not found' });
        return;
      }

      if (game.phase !== 'lobby') {
        socket.emit('join_error', { message: 'Game has already started' });
        return;
      }

      const nameTaken = game.players.some((p) => p.name === playerName);
      if (nameTaken) {
        socket.emit('join_error', { message: 'Name already taken' });
        return;
      }

      // If hostSecret matches, claim storyteller role
      let currentGame = game;
      if (hostSecret && game.hostSecret && hostSecret === game.hostSecret) {
        currentGame = setStoryteller(game, socket.id);
      }

      const player: Player = {
        id: socket.id,
        name: playerName,
        trueRole: 'washerwoman',
        apparentRole: 'washerwoman',
        isAlive: true,
        isPoisoned: false,
        isDrunk: false,
        hasGhostVote: true,
        ghostVoteUsed: false,
        seatIndex: currentGame.players.length,
      };

      const updatedGame = addPlayer(currentGame, player);
      store.games.set(currentGame.id, updatedGame);

      socket.join(currentGame.id);
      socket.emit('game_joined', { gameId: currentGame.id, playerId: player.id });
      io.to(currentGame.id).emit('player_joined', { player: { id: player.id, name: player.name, seatIndex: player.seatIndex } });
      io.to(currentGame.id).emit('game_state', updatedGame);
    });

    socket.on('start_game', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('start_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('start_error', { message: 'Only the host can start the game' });
        return;
      }

      if (game.phase !== 'lobby') {
        socket.emit('start_error', { message: 'Game has already started' });
        return;
      }

      if (game.players.length < 5 || game.players.length > 15) {
        socket.emit('start_error', { message: 'Player count must be between 5 and 15' });
        return;
      }

      const withRoles = assignAllRoles(game);
      const updatedGame = transitionPhase(withRoles, 'setup');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('game_started', { gameId: game.id });

      // Send each player their private role card (using apparentRole so Drunk sees their fake role)
      for (const player of updatedGame.players) {
        const roleMeta = ROLE_MAP.get(player.apparentRole);
        if (roleMeta) {
          io.to(player.id).emit('your_role', {
            role: roleMeta.id,
            name: roleMeta.name,
            team: roleMeta.team,
            ability: roleMeta.ability,
          });
        }
      }

      // Send the Storyteller the Grimoire with all true roles
      if (updatedGame.storytellerId) {
        const grimoire = updatedGame.players.map((p) => {
          const trueMeta = ROLE_MAP.get(p.trueRole);
          const apparentMeta = ROLE_MAP.get(p.apparentRole);
          return {
            playerId: p.id,
            playerName: p.name,
            trueRole: trueMeta ? { id: trueMeta.id, name: trueMeta.name, team: trueMeta.team, ability: trueMeta.ability } : null,
            apparentRole: apparentMeta ? { id: apparentMeta.id, name: apparentMeta.name, team: apparentMeta.team, ability: apparentMeta.ability } : null,
            isAlive: p.isAlive,
            isPoisoned: p.isPoisoned,
            isDrunk: p.isDrunk,
          };
        });
        io.to(updatedGame.storytellerId).emit('grimoire', {
          players: grimoire,
          fortuneTellerRedHerringId: updatedGame.fortuneTellerRedHerringId,
        });
      }

      // Send Minion info: each Minion learns other Minions and the Demon
      const minions = updatedGame.players.filter((p) => {
        const meta = ROLE_MAP.get(p.trueRole);
        return meta && meta.type === 'minion';
      });
      const demons = updatedGame.players.filter((p) => {
        const meta = ROLE_MAP.get(p.trueRole);
        return meta && meta.type === 'demon';
      });

      for (const minion of minions) {
        const otherMinions = minions
          .filter((m) => m.id !== minion.id)
          .map((m) => ({ playerId: m.id, playerName: m.name, role: m.trueRole }));
        const demonInfo = demons.map((d) => ({ playerId: d.id, playerName: d.name, role: d.trueRole }));
        io.to(minion.id).emit('minion_info', {
          otherMinions,
          demon: demonInfo,
        });
      }

      // Send Demon info: Demon learns Minion identities and 3 bluff roles
      for (const demon of demons) {
        const minionInfo = minions.map((m) => ({ playerId: m.id, playerName: m.name, role: m.trueRole }));
        io.to(demon.id).emit('demon_info', {
          minions: minionInfo,
          bluffRoles: updatedGame.demonBluffRoles,
        });
      }

      // Broadcast sanitized game state (no role info leaked to players)
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('transition_to_day', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('transition_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('transition_error', { message: 'Only the Storyteller can transition phases' });
        return;
      }

      if (game.phase !== 'night' && game.phase !== 'setup') {
        socket.emit('transition_error', { message: 'Can only transition to day from night or setup phase' });
        return;
      }

      const updatedGame = resolveDawnDeaths(game);
      store.games.set(game.id, updatedGame);

      // Build dawn announcement: deaths by player name (not role)
      const deaths = game.pendingDeaths.map((pid) => {
        const player = game.players.find((p) => p.id === pid);
        return { playerId: pid, playerName: player?.name ?? 'Unknown' };
      });

      io.to(game.id).emit('dawn_announcement', {
        deaths,
        dayNumber: updatedGame.dayNumber,
        message: deaths.length === 0 ? 'No one died last night.' : undefined,
      });

      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('start_discussion', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('discussion_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('discussion_error', { message: 'Only the Storyteller can start discussion' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'dawn') {
        socket.emit('discussion_error', { message: 'Can only start discussion from dawn phase' });
        return;
      }

      const updatedGame = transitionDaySubPhase(game, 'discussion');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('discussion_started', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('end_discussion', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('discussion_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('discussion_error', { message: 'Only the Storyteller can end discussion' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'discussion') {
        socket.emit('discussion_error', { message: 'Can only end discussion during discussion phase' });
        return;
      }

      const updatedGame = transitionDaySubPhase(game, 'nomination');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('discussion_ended', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('open_nominations', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('nomination_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('nomination_error', { message: 'Only the Storyteller can open nominations' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'discussion') {
        socket.emit('nomination_error', { message: 'Can only open nominations from discussion phase' });
        return;
      }

      // Clear nominations from previous rounds and transition to nomination sub-phase
      let updatedGame = clearNominations(game);
      updatedGame = transitionDaySubPhase(updatedGame, 'nomination');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('nominations_opened', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('close_nominations', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('nomination_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('nomination_error', { message: 'Only the Storyteller can close nominations' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'nomination') {
        socket.emit('nomination_error', { message: 'Can only close nominations during nomination phase' });
        return;
      }

      const updatedGame = transitionDaySubPhase(game, 'end');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('nominations_closed', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('nominate', (data: { gameId: string; nomineeId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('nomination_error', { message: 'Game not found' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'nomination') {
        socket.emit('nomination_error', { message: 'Nominations are not open' });
        return;
      }

      // Find the nominator
      const nominator = game.players.find((p) => p.id === socket.id);
      if (!nominator) {
        socket.emit('nomination_error', { message: 'You are not in this game' });
        return;
      }

      // Dead players cannot nominate
      if (!nominator.isAlive) {
        socket.emit('nomination_error', { message: 'Dead players cannot nominate' });
        return;
      }

      // Check if nominator has already nominated today
      const hasNominated = game.nominations.some((n) => n.nominatorId === socket.id);
      if (hasNominated) {
        socket.emit('nomination_error', { message: 'You have already nominated today' });
        return;
      }

      // Find the nominee
      const nominee = game.players.find((p) => p.id === data.nomineeId);
      if (!nominee) {
        socket.emit('nomination_error', { message: 'Nominated player not found' });
        return;
      }

      // Nominee must be alive
      if (!nominee.isAlive) {
        socket.emit('nomination_error', { message: 'Cannot nominate a dead player' });
        return;
      }

      // Check if nominee has already been nominated today
      const hasBeenNominated = game.nominations.some((n) => n.nomineeId === data.nomineeId);
      if (hasBeenNominated) {
        socket.emit('nomination_error', { message: 'That player has already been nominated today' });
        return;
      }

      // Cannot nominate yourself
      if (socket.id === data.nomineeId) {
        socket.emit('nomination_error', { message: 'You cannot nominate yourself' });
        return;
      }

      const updatedGame = addNomination(game, socket.id, data.nomineeId);
      store.games.set(game.id, updatedGame);

      const nominatorName = nominator.name;
      const nomineeName = nominee.name;

      io.to(game.id).emit('nomination_made', {
        nominatorId: socket.id,
        nominatorName,
        nomineeId: data.nomineeId,
        nomineeName,
      });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);

      const game = findGameByPlayerId(store, socket.id);
      if (!game) return;

      // Only remove from lobby; in-game disconnects are handled differently
      if (game.phase !== 'lobby') return;

      const updatedGame = removePlayer(game, socket.id);
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('player_left', { playerId: socket.id });
      io.to(game.id).emit('game_state', updatedGame);
    });
  });
}
