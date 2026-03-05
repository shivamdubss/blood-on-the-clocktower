import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'imp',
  name: 'Imp',
  team: 'demon',
  type: 'demon',
  ability: 'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.',
  firstNight: false,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
