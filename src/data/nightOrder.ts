import type { RoleId } from '../types/game.js';

// Night 1 order: Minion info, Demon info, then roles in official order
export const NIGHT_1_ORDER: RoleId[] = [
  // Minion info and Demon info are handled as special setup steps
  // before individual role abilities
  'poisoner',
  'spy',
  'washerwoman',
  'librarian',
  'investigator',
  'chef',
  'empath',
  'fortuneTeller',
  'butler',
];

// Night 2+ order
export const NIGHT_OTHER_ORDER: RoleId[] = [
  'poisoner',
  'monk',
  'spy',
  'imp',
  'ravenkeeper',
  'empath',
  'fortuneTeller',
  'undertaker',
  'butler',
];
