import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'virgin',
  name: 'Virgin',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.',
  firstNight: false,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
