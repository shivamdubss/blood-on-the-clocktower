import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'poisoner',
  name: 'Poisoner',
  team: 'minion',
  type: 'minion',
  ability: 'Each night, choose a player: they are poisoned tonight and tomorrow day.',
  firstNight: true,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const { gameState, isPoisoned } = context;
  const targetInput = input as { targetPlayerId?: string } | undefined;

  if (!targetInput?.targetPlayerId) {
    return { success: false, message: 'No target selected' };
  }

  const target = gameState.players.find((p) => p.id === targetInput.targetPlayerId);
  if (!target) {
    return { success: false, message: 'Target player not found' };
  }

  // If poisoned, the Poisoner's ability has no effect (target is not actually poisoned)
  if (isPoisoned) {
    return { success: true, data: { targetPlayerId: targetInput.targetPlayerId, effective: false } };
  }

  // Clear all previous poison and apply new poison to the target
  const updatedPlayers = gameState.players.map((p) => ({
    ...p,
    isPoisoned: p.id === targetInput.targetPlayerId,
  }));

  return {
    success: true,
    data: { targetPlayerId: targetInput.targetPlayerId, effective: true },
    stateMutation: { players: updatedPlayers },
  };
};
