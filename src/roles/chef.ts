import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'chef',
  name: 'Chef',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'You start knowing how many pairs of Evil players there are.',
  firstNight: true,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const data = input as { number?: number } | undefined;
  if (data?.number === undefined || typeof data.number !== 'number') {
    return { success: false, message: 'Must provide a number (evil pair count)' };
  }

  const isCorrupted = context.isPoisoned || context.isDrunk;

  return {
    success: true,
    data: {
      number: data.number,
      isCorrupted,
    },
  };
};
