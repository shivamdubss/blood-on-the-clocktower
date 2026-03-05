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

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
