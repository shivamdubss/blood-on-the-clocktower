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

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
