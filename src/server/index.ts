import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createInitialGameState } from './gameStateMachine.js';
import { registerSocketHandlers, type GameStore } from './socketHandlers.js';
import type { GameState } from '../types/game.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(express.json());

const store: GameStore = {
  games: new Map<string, GameState>(),
};

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Create a new game
app.post('/api/game', (req, res) => {
  const id = Math.random().toString(36).slice(2, 10);
  const joinCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const storytellerId = req.body?.storytellerId ?? id;

  const game = createInitialGameState(id, joinCode, storytellerId);
  store.games.set(id, game);

  res.json({ gameId: id, joinCode });
});

registerSocketHandlers(io, store);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
httpServer.listen(PORT, () => {
  console.log(`BotC server running on port ${PORT}`);
});

export { app, httpServer };
