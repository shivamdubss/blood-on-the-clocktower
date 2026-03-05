import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'recluse',
  name: 'Recluse',
  team: 'outsider',
  type: 'outsider',
  ability: 'You might register as Evil & as a Minion or Demon, even if dead.',
  firstNight: false,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
