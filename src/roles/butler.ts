import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'butler',
  name: 'Butler',
  team: 'outsider',
  type: 'outsider',
  ability: 'Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.',
  firstNight: true,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const { gameState, player } = context;
  const { targetPlayerId } = input as { targetPlayerId?: string };

  if (!targetPlayerId) {
    return { success: false, message: 'Must choose a player as master' };
  }

  const target = gameState.players.find((p) => p.id === targetPlayerId);
  if (!target) {
    return { success: false, message: 'Target player not found' };
  }

  if (!target.isAlive) {
    return { success: false, message: 'Target player is dead' };
  }

  if (target.id === player.id) {
    return { success: false, message: 'Cannot choose yourself as master' };
  }

  const isCorrupted = context.isPoisoned || context.isDrunk;

  return {
    success: true,
    data: { targetPlayerId, isCorrupted },
    stateMutation: {
      butlerMasterId: targetPlayerId,
    },
  };
};
