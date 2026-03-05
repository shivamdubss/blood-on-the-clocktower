import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'undertaker',
  name: 'Undertaker',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'Each night*, you learn which character died by execution today.',
  firstNight: false,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
