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

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
