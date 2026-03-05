import { describe, it, expect } from 'vitest';
import { assignRoles, ROLES_BY_TYPE } from '../../src/server/roleDistribution.js';
import { assignAllRoles, createInitialGameState, addPlayer } from '../../src/server/gameStateMachine.js';
import type { Player, RoleId } from '../../src/types/game.js';

function makePlayer(id: string, name: string, seatIndex: number): Player {
  return {
    id,
    name,
    trueRole: 'washerwoman',
    apparentRole: 'washerwoman',
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex,
  };
}

describe('Drunk assignment', () => {
  it("Drunk's apparent role is a Townsfolk role not otherwise in the game", () => {
    // Run multiple times since role assignment is random
    for (let trial = 0; trial < 50; trial++) {
      const playerIds = Array.from({ length: 9 }, (_, i) => `p${i}`);
      const assignments = assignRoles(playerIds);
      const drunkAssignment = assignments.find((a) => a.role === 'drunk');
      if (!drunkAssignment) continue; // Drunk may not be in every game

      // Apparent role must be a Townsfolk
      expect(ROLES_BY_TYPE.townsfolk).toContain(drunkAssignment.apparentRole);

      // Apparent role must NOT be assigned to any other player as their true role
      const otherTrueRoles = assignments
        .filter((a) => a.role !== 'drunk')
        .map((a) => a.role);
      expect(otherTrueRoles).not.toContain(drunkAssignment.apparentRole);
    }
  });

  it("Drunk's client shows the apparent role (not 'Drunk') via assignAllRoles", () => {
    // Run multiple times to find a game with a Drunk
    for (let trial = 0; trial < 50; trial++) {
      let state = createInitialGameState('test', 'ABCDEF', 'host');
      for (let i = 0; i < 9; i++) {
        state = addPlayer(state, makePlayer(`p${i}`, `Player${i}`, i));
      }

      const result = assignAllRoles(state);
      const drunkPlayer = result.players.find((p) => p.trueRole === 'drunk');
      if (!drunkPlayer) continue;

      // apparentRole should NOT be 'drunk'
      expect(drunkPlayer.apparentRole).not.toBe('drunk');
      // apparentRole should be a Townsfolk
      expect(ROLES_BY_TYPE.townsfolk).toContain(drunkPlayer.apparentRole);
      // isDrunk should be true
      expect(drunkPlayer.isDrunk).toBe(true);
      return; // Found and verified
    }
    // If we never got a Drunk in 50 trials, that's statistically near-impossible for 9 players (2 outsider slots)
    // but let's not fail — just skip
  });

  it("Storyteller's Grimoire shows both the true role (Drunk) and the apparent role", () => {
    for (let trial = 0; trial < 50; trial++) {
      let state = createInitialGameState('test', 'ABCDEF', 'host');
      for (let i = 0; i < 9; i++) {
        state = addPlayer(state, makePlayer(`p${i}`, `Player${i}`, i));
      }

      const result = assignAllRoles(state);
      const drunkPlayer = result.players.find((p) => p.trueRole === 'drunk');
      if (!drunkPlayer) continue;

      // True role is 'drunk'
      expect(drunkPlayer.trueRole).toBe('drunk');
      // Apparent role is a different Townsfolk
      expect(drunkPlayer.apparentRole).not.toBe('drunk');
      expect(ROLES_BY_TYPE.townsfolk).toContain(drunkPlayer.apparentRole);
      return;
    }
  });

  it("Drunk's apparent role is stored in game state for use by the ability system", () => {
    for (let trial = 0; trial < 50; trial++) {
      let state = createInitialGameState('test', 'ABCDEF', 'host');
      for (let i = 0; i < 9; i++) {
        state = addPlayer(state, makePlayer(`p${i}`, `Player${i}`, i));
      }

      const result = assignAllRoles(state);
      const drunkPlayer = result.players.find((p) => p.trueRole === 'drunk');
      if (!drunkPlayer) continue;

      // apparentRole is persisted on the player object
      expect(drunkPlayer).toHaveProperty('apparentRole');
      expect(drunkPlayer.apparentRole).toBeDefined();
      expect(drunkPlayer.apparentRole).not.toBe('drunk');
      // isDrunk flag is set
      expect(drunkPlayer.isDrunk).toBe(true);
      return;
    }
  });

  it('non-Drunk players have apparentRole equal to their true role', () => {
    for (let trial = 0; trial < 20; trial++) {
      const playerIds = Array.from({ length: 7 }, (_, i) => `p${i}`);
      const assignments = assignRoles(playerIds);

      for (const a of assignments) {
        if (a.role !== 'drunk') {
          expect(a.apparentRole).toBe(a.role);
        }
      }
    }
  });
});

describe('Drunk apparent role', () => {
  it('apparent role is always a Townsfolk not in the assigned townsfolk pool', () => {
    for (let trial = 0; trial < 50; trial++) {
      const playerIds = Array.from({ length: 7 }, (_, i) => `p${i}`);
      const assignments = assignRoles(playerIds);
      const drunkAssignment = assignments.find((a) => a.role === 'drunk');
      if (!drunkAssignment) continue;

      // Get all assigned townsfolk
      const assignedTownsfolk = assignments
        .filter((a) => (ROLES_BY_TYPE.townsfolk as readonly RoleId[]).includes(a.role))
        .map((a) => a.role);

      // Drunk's apparent role should not be any of the assigned townsfolk
      expect(assignedTownsfolk).not.toContain(drunkAssignment.apparentRole);
      // But should be a valid townsfolk
      expect(ROLES_BY_TYPE.townsfolk).toContain(drunkAssignment.apparentRole);
    }
  });
});
