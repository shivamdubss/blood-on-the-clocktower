import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'saint',
  name: 'Saint',
  team: 'outsider',
  type: 'outsider',
  ability: 'If you die by execution, your team loses.',
  firstNight: false,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
