import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'poisoner',
  name: 'Poisoner',
  team: 'minion',
  type: 'minion',
  ability: 'Each night, choose a player: they are poisoned tonight and tomorrow day.',
  firstNight: true,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
