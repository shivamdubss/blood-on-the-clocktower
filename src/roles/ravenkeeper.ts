import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'ravenkeeper',
  name: 'Ravenkeeper',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'If you die at night, you are woken to choose a player: you learn their character.',
  firstNight: false,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const { isPoisoned, isDrunk } = context;
  const rkInput = input as { targetPlayerId?: string; role?: string; notTriggered?: boolean } | undefined;

  // If Ravenkeeper was not killed tonight, no action needed
  if (rkInput?.notTriggered) {
    return { success: true, data: { triggered: false } };
  }

  if (!rkInput?.targetPlayerId) {
    return { success: false, message: 'No target player selected' };
  }

  if (!rkInput?.role) {
    return { success: false, message: 'No role provided' };
  }

  const target = context.gameState.players.find((p) => p.id === rkInput.targetPlayerId);
  if (!target) {
    return { success: false, message: 'Target player not found' };
  }

  const isCorrupted = isPoisoned || isDrunk;

  return {
    success: true,
    data: {
      triggered: true,
      targetPlayerId: rkInput.targetPlayerId,
      revealedRole: rkInput.role,
      isCorrupted,
    },
  };
};
