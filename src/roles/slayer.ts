import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'slayer',
  name: 'Slayer',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'Once per game, during the day, publicly choose a player: if they are the Demon, they die.',
  firstNight: false,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
