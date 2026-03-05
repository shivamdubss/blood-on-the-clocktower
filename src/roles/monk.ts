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

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
