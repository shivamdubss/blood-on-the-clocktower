import type { Server, Socket } from 'socket.io';
import type { GameState, Player } from '../types/game.js';
import { addPlayer, removePlayer, transitionPhase } from './gameStateMachine.js';

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

export function registerSocketHandlers(io: Server, store: GameStore): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join_game', (data: { joinCode: string; playerName: string }) => {
      const { joinCode, playerName } = data;
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
        seatIndex: game.players.length,
      };

      const updatedGame = addPlayer(game, player);
      store.games.set(game.id, updatedGame);

      socket.join(game.id);
      socket.emit('game_joined', { gameId: game.id, playerId: player.id });
      io.to(game.id).emit('player_joined', { player: { id: player.id, name: player.name, seatIndex: player.seatIndex } });
      io.to(game.id).emit('game_state', updatedGame);
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

      const updatedGame = transitionPhase(game, 'setup');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('game_started', { gameId: game.id });
      io.to(game.id).emit('game_state', updatedGame);
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
