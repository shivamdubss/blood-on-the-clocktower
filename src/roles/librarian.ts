import type { RoleMetadata } from '../types/game.js';
import type { AbilityHandler } from '../types/ability.js';

export const metadata: RoleMetadata = {
  id: 'librarian',
  name: 'Librarian',
  team: 'townsfolk',
  type: 'townsfolk',
  ability: 'You start knowing that 1 of 2 players is a particular Outsider. (Or that there are no Outsiders in play.)',
  firstNight: true,
  otherNights: false,
};

export const abilityHandler: AbilityHandler = (context, input) => {
  const data = input as { player1Id?: string; player2Id?: string; revealedRole?: string; noOutsiders?: boolean } | undefined;

  // Handle "no Outsiders in play" case
  if (data?.noOutsiders) {
    const isCorrupted = context.isPoisoned || context.isDrunk;
    return {
      success: true,
      data: {
        noOutsiders: true,
        isCorrupted,
      },
    };
  }

  if (!data?.player1Id || !data?.player2Id || !data?.revealedRole) {
    return { success: false, message: 'Must provide player1Id, player2Id, and revealedRole (or noOutsiders: true)' };
  }

  const player1 = context.gameState.players.find((p) => p.id === data.player1Id);
  const player2 = context.gameState.players.find((p) => p.id === data.player2Id);
  if (!player1 || !player2) {
    return { success: false, message: 'Invalid player IDs' };
  }

  const isCorrupted = context.isPoisoned || context.isDrunk;

  return {
    success: true,
    data: {
      player1Id: data.player1Id,
      player1Name: player1.name,
      player2Id: data.player2Id,
      player2Name: player2.name,
      revealedRole: data.revealedRole,
      isCorrupted,
    },
  };
};
