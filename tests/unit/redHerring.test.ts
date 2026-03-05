import { describe, it, expect } from 'vitest';
import { assignRoles, getRoleType, ROLES_BY_TYPE } from '../../src/server/roleDistribution.js';
import { assignAllRoles, createInitialGameState, addPlayer, killPlayer } from '../../src/server/gameStateMachine.js';
import type { Player } from '../../src/types/game.js';

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

function createGameWithPlayers(count: number) {
  let state = createInitialGameState('test', 'ABCDEF', 'host');
  for (let i = 0; i < count; i++) {
    state = addPlayer(state, makePlayer(`p${i}`, `Player${i}`, i));
  }
  return state;
}

describe('red herring', () => {
  it('one Good player is designated as the Fortune Teller red herring when Fortune Teller is in the game', () => {
    let foundFortuneTellerGame = false;
    for (let trial = 0; trial < 100 && !foundFortuneTellerGame; trial++) {
      const playerIds = Array.from({ length: 7 }, (_, i) => `p${i}`);
      const result = assignRoles(playerIds);

      const hasFortuneTeller = result.assignments.some((a) => a.role === 'fortuneTeller');
      if (!hasFortuneTeller) continue;

      foundFortuneTellerGame = true;

      // Red herring must be assigned
      expect(result.fortuneTellerRedHerringId).not.toBeNull();

      // Red herring must be a Good player (Townsfolk or Outsider), not the Fortune Teller
      const redHerring = result.assignments.find((a) => a.playerId === result.fortuneTellerRedHerringId);
      expect(redHerring).toBeDefined();
      const roleType = getRoleType(redHerring!.role);
      expect(['townsfolk', 'outsider']).toContain(roleType);
      expect(redHerring!.role).not.toBe('fortuneTeller');
    }

    expect(foundFortuneTellerGame).toBe(true);
  });

  it('red herring is null when Fortune Teller is not in the game', () => {
    let foundNoFortuneTellerGame = false;
    for (let trial = 0; trial < 100 && !foundNoFortuneTellerGame; trial++) {
      const playerIds = Array.from({ length: 5 }, (_, i) => `p${i}`);
      const result = assignRoles(playerIds);

      const hasFortuneTeller = result.assignments.some((a) => a.role === 'fortuneTeller');
      if (hasFortuneTeller) continue;

      foundNoFortuneTellerGame = true;
      expect(result.fortuneTellerRedHerringId).toBeNull();
    }

    expect(foundNoFortuneTellerGame).toBe(true);
  });

  it('red herring assignment is stored in game state via assignAllRoles', () => {
    let foundFortuneTellerGame = false;
    for (let trial = 0; trial < 100 && !foundFortuneTellerGame; trial++) {
      const state = createGameWithPlayers(7);
      const result = assignAllRoles(state);

      const hasFortuneTeller = result.players.some((p) => p.trueRole === 'fortuneTeller');
      if (!hasFortuneTeller) continue;

      foundFortuneTellerGame = true;

      // fortuneTellerRedHerringId should be set on the game state
      expect(result.fortuneTellerRedHerringId).not.toBeNull();

      // The red herring player must exist and be a Good player
      const redHerringPlayer = result.players.find((p) => p.id === result.fortuneTellerRedHerringId);
      expect(redHerringPlayer).toBeDefined();
      const roleType = getRoleType(redHerringPlayer!.trueRole);
      expect(['townsfolk', 'outsider']).toContain(roleType);
      expect(redHerringPlayer!.trueRole).not.toBe('fortuneTeller');
    }

    expect(foundFortuneTellerGame).toBe(true);
  });

  it('red herring does not change when the player dies', () => {
    let foundFortuneTellerGame = false;
    for (let trial = 0; trial < 100 && !foundFortuneTellerGame; trial++) {
      const state = createGameWithPlayers(7);
      const withRoles = assignAllRoles(state);

      const hasFortuneTeller = withRoles.players.some((p) => p.trueRole === 'fortuneTeller');
      if (!hasFortuneTeller) continue;
      if (!withRoles.fortuneTellerRedHerringId) continue;

      foundFortuneTellerGame = true;

      const redHerringId = withRoles.fortuneTellerRedHerringId;

      // Kill the red herring player
      const afterKill = killPlayer(withRoles, redHerringId);

      // Red herring ID should remain the same
      expect(afterKill.fortuneTellerRedHerringId).toBe(redHerringId);

      // Player is dead but still the red herring
      const deadPlayer = afterKill.players.find((p) => p.id === redHerringId);
      expect(deadPlayer).toBeDefined();
      expect(deadPlayer!.isAlive).toBe(false);
      expect(afterKill.fortuneTellerRedHerringId).toBe(redHerringId);
    }

    expect(foundFortuneTellerGame).toBe(true);
  });
});

describe('Fortune Teller setup', () => {
  it('red herring is visible in the Grimoire (stored on game state)', () => {
    let foundFortuneTellerGame = false;
    for (let trial = 0; trial < 100 && !foundFortuneTellerGame; trial++) {
      const state = createGameWithPlayers(7);
      const result = assignAllRoles(state);

      const hasFortuneTeller = result.players.some((p) => p.trueRole === 'fortuneTeller');
      if (!hasFortuneTeller) continue;

      foundFortuneTellerGame = true;

      // The fortuneTellerRedHerringId field exists and is a valid player ID
      expect(result.fortuneTellerRedHerringId).not.toBeNull();
      const playerIds = result.players.map((p) => p.id);
      expect(playerIds).toContain(result.fortuneTellerRedHerringId);
    }

    expect(foundFortuneTellerGame).toBe(true);
  });

  it('red herring is always a Good player across many trials', () => {
    const goodTeams = ['townsfolk', 'outsider'];
    for (let trial = 0; trial < 100; trial++) {
      const playerIds = Array.from({ length: 9 }, (_, i) => `p${i}`);
      const result = assignRoles(playerIds);

      if (!result.fortuneTellerRedHerringId) continue;

      const redHerring = result.assignments.find((a) => a.playerId === result.fortuneTellerRedHerringId);
      expect(redHerring).toBeDefined();
      expect(goodTeams).toContain(getRoleType(redHerring!.role));
    }
  });
});
