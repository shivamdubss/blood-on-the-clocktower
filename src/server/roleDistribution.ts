import type { RoleId, RoleType } from '../types/game.js';

/**
 * Official Trouble Brewing distribution table.
 * Key: player count, Value: { townsfolk, outsiders, minions, demon }
 */
export const DISTRIBUTION_TABLE: Record<number, Record<RoleType, number>> = {
  5:  { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  6:  { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  7:  { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  8:  { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  9:  { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 },
};

const TOWNSFOLK_ROLES: RoleId[] = [
  'washerwoman', 'librarian', 'investigator', 'chef', 'empath',
  'fortuneTeller', 'undertaker', 'monk', 'ravenkeeper', 'virgin',
  'slayer', 'soldier', 'mayor',
];

const OUTSIDER_ROLES: RoleId[] = ['butler', 'drunk', 'recluse', 'saint'];

const MINION_ROLES: RoleId[] = ['poisoner', 'spy', 'scarletWoman', 'baron'];

const DEMON_ROLES: RoleId[] = ['imp'];

/** Fisher-Yates shuffle (returns a new array) */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface RoleAssignment {
  playerId: string;
  role: RoleId;
  apparentRole: RoleId;
}

export interface RoleAssignmentResult {
  assignments: RoleAssignment[];
  fortuneTellerRedHerringId: string | null;
  bluffRoles: RoleId[];
}

/**
 * Applies Baron adjustment: if Baron is among the selected minions,
 * shift 2 Townsfolk slots to Outsider slots.
 */
export function applyBaronAdjustment(dist: Record<RoleType, number>, minions: RoleId[]): Record<RoleType, number> {
  if (!minions.includes('baron')) return dist;
  const outsiderSlots = Math.min(dist.townsfolk, 2);
  return {
    ...dist,
    townsfolk: dist.townsfolk - outsiderSlots,
    outsider: dist.outsider + outsiderSlots,
  };
}

/**
 * Assigns roles to players according to the Trouble Brewing distribution table.
 * Returns an array of { playerId, role } assignments.
 */
export function assignRoles(playerIds: string[], playerCount?: number): RoleAssignmentResult {
  const count = playerCount ?? playerIds.length;
  const dist = DISTRIBUTION_TABLE[count];
  if (!dist) {
    throw new Error(`No distribution defined for ${count} players`);
  }

  // Pick minions and demons first to check for Baron
  const minions = shuffle(MINION_ROLES).slice(0, dist.minion);
  const demons = shuffle(DEMON_ROLES).slice(0, dist.demon);

  // Apply Baron adjustment before selecting townsfolk/outsiders
  const adjustedDist = applyBaronAdjustment(dist, minions);

  const townsfolk = shuffle(TOWNSFOLK_ROLES).slice(0, adjustedDist.townsfolk);
  const outsiders = shuffle(OUTSIDER_ROLES).slice(0, adjustedDist.outsider);

  const allRoles = shuffle([...townsfolk, ...outsiders, ...minions, ...demons]);

  if (allRoles.length !== playerIds.length) {
    throw new Error(`Role count (${allRoles.length}) doesn't match player count (${playerIds.length})`);
  }

  // Compute Drunk's apparent Townsfolk role: a Townsfolk not assigned to any player
  const assignedTownsfolk = new Set(townsfolk);
  const drunkApparentRole = allRoles.includes('drunk')
    ? shuffle(TOWNSFOLK_ROLES.filter((r) => !assignedTownsfolk.has(r)))[0]
    : undefined;

  const assignments = playerIds.map((id, i) => ({
    playerId: id,
    role: allRoles[i],
    apparentRole: allRoles[i] === 'drunk' && drunkApparentRole ? drunkApparentRole : allRoles[i],
  }));

  // Assign Fortune Teller red herring: a random Good player (not the Fortune Teller themselves)
  let fortuneTellerRedHerringId: string | null = null;
  if (allRoles.includes('fortuneTeller')) {
    const goodPlayers = assignments.filter(
      (a) => a.role !== 'fortuneTeller' && (TOWNSFOLK_ROLES.includes(a.role) || OUTSIDER_ROLES.includes(a.role))
    );
    if (goodPlayers.length > 0) {
      fortuneTellerRedHerringId = shuffle(goodPlayers)[0].playerId;
    }
  }

  // Compute 3 bluff roles for the Demon: Townsfolk not in play
  const inPlayRoles = new Set(allRoles);
  // Also exclude the Drunk's apparent role since it's "claimed" by a player
  if (drunkApparentRole) inPlayRoles.add(drunkApparentRole);
  const bluffRoles = shuffle(TOWNSFOLK_ROLES.filter((r) => !inPlayRoles.has(r))).slice(0, 3);

  return { assignments, fortuneTellerRedHerringId, bluffRoles };
}

/** Get the team type for a given role */
export function getRoleType(roleId: RoleId): RoleType {
  if (TOWNSFOLK_ROLES.includes(roleId)) return 'townsfolk';
  if (OUTSIDER_ROLES.includes(roleId)) return 'outsider';
  if (MINION_ROLES.includes(roleId)) return 'minion';
  if (DEMON_ROLES.includes(roleId)) return 'demon';
  throw new Error(`Unknown role: ${roleId}`);
}

/** All available roles by type */
export const ROLES_BY_TYPE = {
  townsfolk: TOWNSFOLK_ROLES,
  outsider: OUTSIDER_ROLES,
  minion: MINION_ROLES,
  demon: DEMON_ROLES,
} as const;
