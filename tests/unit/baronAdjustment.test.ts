import { describe, it, expect } from 'vitest';
import { applyBaronAdjustment, assignRoles, DISTRIBUTION_TABLE, getRoleType } from '../../src/server/roleDistribution.js';
import type { RoleType } from '../../src/types/game.js';

describe('Baron adjustment', () => {
  it('when Baron is in the game, 2 Townsfolk slots are replaced by 2 Outsider slots', () => {
    for (let count = 5; count <= 15; count++) {
      const baseDist = DISTRIBUTION_TABLE[count];
      const adjusted = applyBaronAdjustment(baseDist, ['baron']);

      expect(adjusted.outsider).toBe(baseDist.outsider + 2);
      expect(adjusted.townsfolk).toBe(baseDist.townsfolk - 2);
      // Minion and demon unchanged
      expect(adjusted.minion).toBe(baseDist.minion);
      expect(adjusted.demon).toBe(baseDist.demon);
    }
  });

  it('the adjusted distribution still totals the correct player count', () => {
    for (let count = 5; count <= 15; count++) {
      const baseDist = DISTRIBUTION_TABLE[count];
      const adjusted = applyBaronAdjustment(baseDist, ['baron']);

      const total = adjusted.townsfolk + adjusted.outsider + adjusted.minion + adjusted.demon;
      expect(total).toBe(count);
    }
  });

  it('Baron adjustment is applied before role assignment (roles reflect adjusted distribution)', () => {
    // Run multiple times to catch Baron being selected
    let foundBaronGame = false;
    for (let attempt = 0; attempt < 100 && !foundBaronGame; attempt++) {
      const playerIds = Array.from({ length: 7 }, (_, i) => `player-${i}`);
      const assignments = assignRoles(playerIds);

      const hasBaron = assignments.some((a) => a.role === 'baron');
      if (!hasBaron) continue;

      foundBaronGame = true;
      // 7 players: base is 5 townsfolk, 0 outsiders, 1 minion, 1 demon
      // With Baron: 3 townsfolk, 2 outsiders, 1 minion, 1 demon
      const typeCounts: Record<RoleType, number> = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
      for (const a of assignments) {
        typeCounts[getRoleType(a.role)]++;
      }

      expect(typeCounts.townsfolk).toBe(3);
      expect(typeCounts.outsider).toBe(2);
      expect(typeCounts.minion).toBe(1);
      expect(typeCounts.demon).toBe(1);
    }

    expect(foundBaronGame).toBe(true);
  });

  it('does not adjust distribution when Baron is not in the game', () => {
    for (let count = 5; count <= 15; count++) {
      const baseDist = DISTRIBUTION_TABLE[count];
      const adjusted = applyBaronAdjustment(baseDist, ['poisoner']);

      expect(adjusted).toEqual(baseDist);
    }
  });

  it('without Baron, type counts match the original distribution table', () => {
    // Run many times; when Baron is NOT selected, counts should match base table
    for (let attempt = 0; attempt < 50; attempt++) {
      const count = 7;
      const playerIds = Array.from({ length: count }, (_, i) => `player-${i}`);
      const assignments = assignRoles(playerIds);

      const hasBaron = assignments.some((a) => a.role === 'baron');
      const typeCounts: Record<RoleType, number> = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
      for (const a of assignments) {
        typeCounts[getRoleType(a.role)]++;
      }

      if (hasBaron) {
        // Baron game: adjusted
        expect(typeCounts.townsfolk).toBe(3);
        expect(typeCounts.outsider).toBe(2);
      } else {
        // Non-Baron game: original
        expect(typeCounts.townsfolk).toBe(DISTRIBUTION_TABLE[count].townsfolk);
        expect(typeCounts.outsider).toBe(DISTRIBUTION_TABLE[count].outsider);
      }

      // Total always correct
      const total = typeCounts.townsfolk + typeCounts.outsider + typeCounts.minion + typeCounts.demon;
      expect(total).toBe(count);
    }
  });
});

describe('Baron setup', () => {
  it('Baron adjustment replaces exactly 2 Townsfolk with 2 Outsiders', () => {
    const dist = { townsfolk: 5, outsider: 0, minion: 1, demon: 1 };
    const adjusted = applyBaronAdjustment(dist, ['baron']);

    expect(adjusted.townsfolk).toBe(3);
    expect(adjusted.outsider).toBe(2);
  });

  it('Baron adjustment works with multiple minion slots', () => {
    // 10 players: 7 townsfolk, 0 outsiders, 2 minions, 1 demon
    const dist = DISTRIBUTION_TABLE[10];
    const adjusted = applyBaronAdjustment(dist, ['poisoner', 'baron']);

    expect(adjusted.townsfolk).toBe(5);
    expect(adjusted.outsider).toBe(2);
    expect(adjusted.minion).toBe(2);
    expect(adjusted.demon).toBe(1);
    expect(adjusted.townsfolk + adjusted.outsider + adjusted.minion + adjusted.demon).toBe(10);
  });
});
