import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'mayor',
  name: 'Mayor',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.',
  firstNight: false,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
