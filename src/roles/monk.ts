import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'monk',
  name: 'Monk',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'Each night*, choose a player (not yourself): they are safe from the Demon tonight.',
  firstNight: false,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const { gameState, isPoisoned, isDrunk, player } = context;
  const targetInput = input as { targetPlayerId?: string } | undefined;

  if (!targetInput?.targetPlayerId) {
    return { success: false, message: 'No target selected' };
  }

  const target = gameState.players.find((p) => p.id === targetInput.targetPlayerId);
  if (!target) {
    return { success: false, message: 'Target player not found' };
  }

  if (!target.isAlive) {
    return { success: false, message: 'Target player is not alive' };
  }

  if (targetInput.targetPlayerId === player.id) {
    return { success: false, message: 'Monk cannot protect themselves' };
  }

  const isCorrupted = isPoisoned || isDrunk;

  return {
    success: true,
    data: {
      targetPlayerId: targetInput.targetPlayerId,
      effective: !isCorrupted,
      isCorrupted,
    },
  };
};
