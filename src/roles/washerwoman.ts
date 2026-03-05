import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'washerwoman',
  name: 'Washerwoman',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'You start knowing that 1 of 2 players is a particular Townsfolk.',
  firstNight: true,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
