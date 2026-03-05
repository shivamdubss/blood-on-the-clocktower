import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'empath',
  name: 'Empath',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'Each night, you learn how many of your 2 alive neighbours are Evil.',
  firstNight: true,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const data = input as { number?: number } | undefined;
  if (data?.number === undefined || typeof data.number !== 'number') {
    return { success: false, message: 'Must provide a number (evil alive neighbours count)' };
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
