import { describe, it, expect } from 'vitest';
import { assignRoles, DISTRIBUTION_TABLE, getRoleType, ROLES_BY_TYPE } from '../../src/server/roleDistribution.js';
import type { RoleId } from '../../src/types/game.js';

describe('role distribution', () => {
  const allRoles: RoleId[] = [
    ...ROLES_BY_TYPE.townsfolk,
    ...ROLES_BY_TYPE.outsider,
    ...ROLES_BY_TYPE.minion,
    ...ROLES_BY_TYPE.demon,
  ];

  it('distribution table matches official table for every player count (5-15)', () => {
    // Official table from PRD
    const expected: Record<number, { townsfolk: number; outsider: number; minion: number; demon: number }> = {
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

    for (let count = 5; count <= 15; count++) {
      expect(DISTRIBUTION_TABLE[count]).toEqual(expected[count]);
    }
  });

  it('each player receives exactly one role for every player count', () => {
    for (let count = 5; count <= 15; count++) {
      const playerIds = Array.from({ length: count }, (_, i) => `player-${i}`);
      const assignments = assignRoles(playerIds);

      expect(assignments.length).toBe(count);

      // Each player appears exactly once
      const assignedPlayerIds = assignments.map((a) => a.playerId);
      expect(new Set(assignedPlayerIds).size).toBe(count);
    }
  });

  it('all 14 Trouble Brewing roles are available in the role pool', () => {
    expect(allRoles.length).toBe(22); // 13 townsfolk + 4 outsider + 4 minion + 1 demon
    // Verify all 14 roles mentioned in the requirement exist
    const expectedRoles: RoleId[] = [
      'washerwoman', 'librarian', 'investigator', 'chef', 'empath',
      'fortuneTeller', 'undertaker', 'monk', 'ravenkeeper', 'virgin',
      'slayer', 'soldier', 'mayor', 'butler', 'drunk', 'recluse', 'saint',
      'poisoner', 'spy', 'scarletWoman', 'baron', 'imp',
    ];
    for (const role of expectedRoles) {
      expect(allRoles).toContain(role);
    }
  });

  it('Townsfolk, Outsider, Minion, and Demon counts match the table for every player count', () => {
    for (let count = 5; count <= 15; count++) {
      const playerIds = Array.from({ length: count }, (_, i) => `player-${i}`);
      const assignments = assignRoles(playerIds);
      const dist = DISTRIBUTION_TABLE[count];

      const typeCounts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
      for (const a of assignments) {
        const type = getRoleType(a.role);
        typeCounts[type]++;
      }

      expect(typeCounts.townsfolk).toBe(dist.townsfolk);
      expect(typeCounts.outsider).toBe(dist.outsider);
      expect(typeCounts.minion).toBe(dist.minion);
      expect(typeCounts.demon).toBe(dist.demon);
    }
  });

  it('random assignment does not repeat roles within a single game', () => {
    for (let count = 5; count <= 15; count++) {
      const playerIds = Array.from({ length: count }, (_, i) => `player-${i}`);
      const assignments = assignRoles(playerIds);
      const roles = assignments.map((a) => a.role);
      expect(new Set(roles).size).toBe(roles.length);
    }
  });
});

describe('role assignment', () => {
  it('assignRoles assigns roles to the provided player IDs', () => {
    const playerIds = ['a', 'b', 'c', 'd', 'e'];
    const assignments = assignRoles(playerIds);

    expect(assignments.length).toBe(5);
    expect(assignments.map((a) => a.playerId)).toEqual(playerIds);
    for (const a of assignments) {
      expect(a.role).toBeDefined();
    }
  });

  it('throws for invalid player counts', () => {
    expect(() => assignRoles(['a', 'b'])).toThrow();
    expect(() => assignRoles(Array.from({ length: 16 }, (_, i) => `p${i}`))).toThrow();
  });

  it('different calls may produce different assignments (randomized)', () => {
    const playerIds = Array.from({ length: 7 }, (_, i) => `player-${i}`);
    const results = new Set<string>();
    // Run 10 times and check we get at least 2 different assignments
    for (let i = 0; i < 10; i++) {
      const assignments = assignRoles(playerIds);
      results.add(assignments.map((a) => a.role).join(','));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});
