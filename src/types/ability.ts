import type { GameState, Player, RoleId } from './game.js';

export interface AbilityContext {
  gameState: GameState;
  player: Player;
  isPoisoned: boolean;
  isDrunk: boolean;
  nightNumber: number;
  storytellerOverride?: unknown;
}

export interface AbilityResult {
  success: boolean;
  data?: unknown;
  message?: string;
  stateMutation?: Partial<GameState>;
}

export type AbilityHandler = (
  context: AbilityContext,
  input?: unknown
) => AbilityResult;

export interface RoleAbility {
  roleId: RoleId;
  handler: AbilityHandler;
}
