import { create } from 'zustand';
import type { GameState } from '../types/game.js';

interface ClientStore {
  gameState: GameState | null;
  playerId: string | null;
  setGameState: (state: GameState) => void;
  setPlayerId: (id: string) => void;
  reset: () => void;
}

export const useStore = create<ClientStore>((set) => ({
  gameState: null,
  playerId: null,
  setGameState: (gameState) => set({ gameState }),
  setPlayerId: (playerId) => set({ playerId }),
  reset: () => set({ gameState: null, playerId: null }),
}));
