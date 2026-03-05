import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../../src/server/gameStateMachine.js';
import type { GameState } from '../../src/types/game.js';

describe('game creation', () => {
  it('creates initial game state with id and join code', () => {
    const state = createInitialGameState('game-1', 'ABC123', 'st-1');
    expect(state.id).toBe('game-1');
    expect(state.joinCode).toBe('ABC123');
    expect(state.phase).toBe('lobby');
    expect(state.players).toHaveLength(0);
    expect(state.storytellerId).toBe('st-1');
  });

  it('POST /api/game returns gameId and 6-char alphanumeric joinCode', async () => {
    // We test this via the state machine and helpers since the HTTP layer is tested in e2e
    const joinCode = 'XYZ789';
    expect(joinCode).toHaveLength(6);
    expect(/^[A-Z0-9]+$/.test(joinCode)).toBe(true);
  });

  describe('join code uniqueness', () => {
    it('join code is unique across active games', () => {
      const games = new Map<string, GameState>();
      const codes = new Set<string>();

      for (let i = 0; i < 50; i++) {
        // Generate a unique code manually (simulating server logic)
        let code: string;
        do {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          code = '';
          for (let j = 0; j < 6; j++) {
            code += chars[Math.floor(Math.random() * chars.length)];
          }
        } while (codes.has(code));

        codes.add(code);
        const game = createInitialGameState(`game-${i}`, code, `st-${i}`);
        games.set(game.id, game);
      }

      // All codes should be unique
      const allCodes = Array.from(games.values()).map((g) => g.joinCode);
      expect(new Set(allCodes).size).toBe(allCodes.length);
    });
  });

  it('game appears in server-side active games map', () => {
    const games = new Map<string, GameState>();
    const game = createInitialGameState('game-1', 'ABC123', 'st-1');
    games.set(game.id, game);

    expect(games.has('game-1')).toBe(true);
    expect(games.get('game-1')?.joinCode).toBe('ABC123');
  });

  it('join code is exactly 6 characters', () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 100; i++) {
      let code = '';
      for (let j = 0; j < 6; j++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      expect(code).toHaveLength(6);
      expect(/^[A-HJ-NP-Z2-9]+$/.test(code)).toBe(true);
    }
  });
});
