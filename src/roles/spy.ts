import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'spy',
  name: 'Spy',
  team: 'minion',
  type: 'minion',
  ability: 'Each night, you see the Grimoire. You might register as Good & as a Townsfolk or Outsider, even if dead.',
  firstNight: true,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
