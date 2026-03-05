import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'butler',
  name: 'Butler',
  team: 'outsider',
  type: 'outsider',
  ability: 'Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.',
  firstNight: true,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
