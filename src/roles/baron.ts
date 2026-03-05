import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'baron',
  name: 'Baron',
  team: 'minion',
  type: 'minion',
  ability: 'There are extra Outsiders in play. [+2 Outsiders]',
  firstNight: false,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
