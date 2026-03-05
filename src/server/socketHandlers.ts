import type { Server, Socket } from 'socket.io';
import type { GameState, Player } from '../types/game.js';
import { addPlayer, removePlayer, transitionPhase, setStoryteller, assignAllRoles } from './gameStateMachine.js';
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

      // Broadcast sanitized game state (no role info leaked to players)
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
