import type { Server, Socket } from 'socket.io';
import type { GameState } from '../types/game.js';

export interface GameStore {
  games: Map<string, GameState>;
}

export function registerSocketHandlers(io: Server, store: GameStore): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join_game', (data: { joinCode: string; playerName: string }) => {
      const { joinCode, playerName } = data;
      const game = Array.from(store.games.values()).find(
        (g) => g.joinCode === joinCode
      );

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      if (game.phase !== 'lobby') {
        socket.emit('error', { message: 'Game has already started' });
        return;
      }

      const nameTaken = game.players.some((p) => p.name === playerName);
      if (nameTaken) {
        socket.emit('error', { message: 'Name already taken' });
        return;
      }

      socket.join(game.id);
      socket.emit('game_joined', { gameId: game.id });
      io.to(game.id).emit('game_state', game);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}
