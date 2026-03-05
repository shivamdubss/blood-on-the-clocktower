import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'librarian',
  name: 'Librarian',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'You start knowing that 1 of 2 players is a particular Outsider. (Or that there are no Outsiders in play.)',
  firstNight: true,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
