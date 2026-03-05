import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'drunk',
  name: 'Drunk',
  team: 'outsider',
  type: 'outsider',
  ability: 'You do not know you are the Drunk. You think you are a Townsfolk character, but your ability malfunctions.',
  firstNight: false,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
