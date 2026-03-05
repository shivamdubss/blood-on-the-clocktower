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

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateUniqueJoinCode(games: Map<string, GameState>): string {
  const existingCodes = new Set(Array.from(games.values()).map((g) => g.joinCode));
  let code = generateJoinCode();
  while (existingCodes.has(code)) {
    code = generateJoinCode();
  }
  return code;
}

// Create a new game
app.post('/api/game', (req, res) => {
  const id = Math.random().toString(36).slice(2, 10);
  const joinCode = generateUniqueJoinCode(store.games);
  const hostSecret = Math.random().toString(36).slice(2, 14);
  const storytellerId = req.body?.storytellerId ?? null;

  const game = createInitialGameState(id, joinCode, storytellerId, hostSecret);
  store.games.set(id, game);

  const protocol = req.protocol;
  const host = req.get('host') ?? `localhost:${PORT}`;
  const wsUrl = `${protocol === 'https' ? 'wss' : 'ws'}://${host}`;

  res.json({ gameId: id, joinCode, wsUrl, hostSecret });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

registerSocketHandlers(io, store);
httpServer.listen(PORT, () => {
  console.log(`BotC server running on port ${PORT}`);
});

export { app, httpServer, store };
