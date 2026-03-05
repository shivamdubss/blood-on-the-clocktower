import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'undertaker',
  name: 'Undertaker',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'Each night*, you learn which character died by execution today.',
  firstNight: false,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const data = input as { role?: string; noExecution?: boolean } | undefined;

  // If no execution occurred, Undertaker learns nothing
  if (data?.noExecution) {
    return {
      success: true,
      data: {
        noExecution: true,
        isCorrupted: context.isPoisoned || context.isDrunk,
      },
    };
  }

  if (!data?.role || typeof data.role !== 'string') {
    return { success: false, message: 'Must provide a role (executed player role) or noExecution: true' };
  }

  const isCorrupted = context.isPoisoned || context.isDrunk;

  return {
    success: true,
    data: {
      role: data.role,
      isCorrupted,
    },
  };
};
