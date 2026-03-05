import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'fortuneTeller',
  name: 'Fortune Teller',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.',
  firstNight: true,
  otherNights: true,
};

export const abilityHandler: AbilityHandler = (_context, _input) => {
  return { success: true };
};
