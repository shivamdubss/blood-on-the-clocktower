import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'imp',
  name: 'Imp',
  team: 'demon',
  type: 'demon',
  ability: 'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.',
  firstNight: false,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const { gameState, isPoisoned } = context;
  const targetInput = input as { targetPlayerId?: string; starPassMinionId?: string } | undefined;

  if (!targetInput?.targetPlayerId) {
    return { success: false, message: 'No target selected' };
  }

  const target = gameState.players.find((p) => p.id === targetInput.targetPlayerId);
  if (!target) {
    return { success: false, message: 'Target player not found' };
  }

  if (!target.isAlive) {
    return { success: false, message: 'Target is already dead' };
  }

  // If poisoned, the kill does not resolve
  if (isPoisoned) {
    return { success: true, data: { targetPlayerId: targetInput.targetPlayerId, effective: false, reason: 'poisoned' } };
  }

  // Self-target = star-pass
  if (targetInput.targetPlayerId === context.player.id) {
    return {
      success: true,
      data: {
        targetPlayerId: targetInput.targetPlayerId,
        effective: true,
        isStarPass: true,
        starPassMinionId: targetInput.starPassMinionId,
      },
    };
  }

  // Normal kill
  return {
    success: true,
    data: { targetPlayerId: targetInput.targetPlayerId, effective: true, isStarPass: false },
  };
};
