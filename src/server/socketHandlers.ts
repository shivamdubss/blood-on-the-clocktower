import type { Server, Socket } from 'socket.io';
import type { GameState, Player } from '../types/game.js';
import { addPlayer, removePlayer, transitionPhase, setStoryteller, assignAllRoles, resolveDawnDeaths, transitionDaySubPhase, addNomination, clearNominations, startVote, recordVote, resolveVote, resolveExecution, transitionToNight, getNightPromptInfo, advanceNightQueue, revertNightQueueStep, commitNightActions, applyStorytellerOverride, processPoisonerAction } from './gameStateMachine.js';
import type { StorytellerOverride } from '../types/game.js';
import { ROLE_MAP } from '../data/roles.js';

export interface GameStore {
  games: Map<string, GameState>;
}

function findGameByJoinCode(store: GameStore, joinCode: string): GameState | undefined {
  return Array.from(store.games.values()).find((g) => g.joinCode === joinCode);
}

function findGameByPlayerId(store: GameStore, playerId: string): GameState | undefined {
  return Array.from(store.games.values()).find((g) =>
    g.players.some((p) => p.id === playerId)
  );
}

function sanitizeGameStateForPlayer(state: GameState): GameState {
  return {
    ...state,
    hostSecret: '',
    demonBluffRoles: [],
    players: state.players.map((p) => ({
      ...p,
      trueRole: 'washerwoman' as const,
      apparentRole: 'washerwoman' as const,
      isPoisoned: false,
      isDrunk: false,
    })),
  };
}

export function registerSocketHandlers(io: Server, store: GameStore): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join_game', (data: { joinCode: string; playerName: string; hostSecret?: string }) => {
      const { joinCode, playerName, hostSecret } = data;
      const game = findGameByJoinCode(store, joinCode);

      if (!game) {
        socket.emit('join_error', { message: 'Game not found' });
        return;
      }

      if (game.phase !== 'lobby') {
        socket.emit('join_error', { message: 'Game has already started' });
        return;
      }

      const nameTaken = game.players.some((p) => p.name === playerName);
      if (nameTaken) {
        socket.emit('join_error', { message: 'Name already taken' });
        return;
      }

      // If hostSecret matches, claim storyteller role
      let currentGame = game;
      if (hostSecret && game.hostSecret && hostSecret === game.hostSecret) {
        currentGame = setStoryteller(game, socket.id);
      }

      const player: Player = {
        id: socket.id,
        name: playerName,
        trueRole: 'washerwoman',
        apparentRole: 'washerwoman',
        isAlive: true,
        isPoisoned: false,
        isDrunk: false,
        hasGhostVote: true,
        ghostVoteUsed: false,
        seatIndex: currentGame.players.length,
      };

      const updatedGame = addPlayer(currentGame, player);
      store.games.set(currentGame.id, updatedGame);

      socket.join(currentGame.id);
      socket.emit('game_joined', { gameId: currentGame.id, playerId: player.id });
      io.to(currentGame.id).emit('player_joined', { player: { id: player.id, name: player.name, seatIndex: player.seatIndex } });
      io.to(currentGame.id).emit('game_state', updatedGame);
    });

    socket.on('start_game', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('start_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('start_error', { message: 'Only the host can start the game' });
        return;
      }

      if (game.phase !== 'lobby') {
        socket.emit('start_error', { message: 'Game has already started' });
        return;
      }

      if (game.players.length < 5 || game.players.length > 15) {
        socket.emit('start_error', { message: 'Player count must be between 5 and 15' });
        return;
      }

      const withRoles = assignAllRoles(game);
      const updatedGame = transitionPhase(withRoles, 'setup');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('game_started', { gameId: game.id });

      // Send each player their private role card (using apparentRole so Drunk sees their fake role)
      for (const player of updatedGame.players) {
        const roleMeta = ROLE_MAP.get(player.apparentRole);
        if (roleMeta) {
          io.to(player.id).emit('your_role', {
            role: roleMeta.id,
            name: roleMeta.name,
            team: roleMeta.team,
            ability: roleMeta.ability,
          });
        }
      }

      // Send the Storyteller the Grimoire with all true roles
      if (updatedGame.storytellerId) {
        const grimoire = updatedGame.players.map((p) => {
          const trueMeta = ROLE_MAP.get(p.trueRole);
          const apparentMeta = ROLE_MAP.get(p.apparentRole);
          return {
            playerId: p.id,
            playerName: p.name,
            trueRole: trueMeta ? { id: trueMeta.id, name: trueMeta.name, team: trueMeta.team, ability: trueMeta.ability } : null,
            apparentRole: apparentMeta ? { id: apparentMeta.id, name: apparentMeta.name, team: apparentMeta.team, ability: apparentMeta.ability } : null,
            isAlive: p.isAlive,
            isPoisoned: p.isPoisoned,
            isDrunk: p.isDrunk,
          };
        });
        io.to(updatedGame.storytellerId).emit('grimoire', {
          players: grimoire,
          fortuneTellerRedHerringId: updatedGame.fortuneTellerRedHerringId,
        });
      }

      // Send Minion info: each Minion learns other Minions and the Demon
      const minions = updatedGame.players.filter((p) => {
        const meta = ROLE_MAP.get(p.trueRole);
        return meta && meta.type === 'minion';
      });
      const demons = updatedGame.players.filter((p) => {
        const meta = ROLE_MAP.get(p.trueRole);
        return meta && meta.type === 'demon';
      });

      for (const minion of minions) {
        const otherMinions = minions
          .filter((m) => m.id !== minion.id)
          .map((m) => ({ playerId: m.id, playerName: m.name, role: m.trueRole }));
        const demonInfo = demons.map((d) => ({ playerId: d.id, playerName: d.name, role: d.trueRole }));
        io.to(minion.id).emit('minion_info', {
          otherMinions,
          demon: demonInfo,
        });
      }

      // Send Demon info: Demon learns Minion identities and 3 bluff roles
      for (const demon of demons) {
        const minionInfo = minions.map((m) => ({ playerId: m.id, playerName: m.name, role: m.trueRole }));
        io.to(demon.id).emit('demon_info', {
          minions: minionInfo,
          bluffRoles: updatedGame.demonBluffRoles,
        });
      }

      // Broadcast sanitized game state (no role info leaked to players)
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('transition_to_day', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('transition_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('transition_error', { message: 'Only the Storyteller can transition phases' });
        return;
      }

      if (game.phase !== 'night' && game.phase !== 'setup') {
        socket.emit('transition_error', { message: 'Can only transition to day from night or setup phase' });
        return;
      }

      const updatedGame = resolveDawnDeaths(game);
      store.games.set(game.id, updatedGame);

      // Build dawn announcement: deaths by player name (not role)
      const deaths = game.pendingDeaths.map((pid) => {
        const player = game.players.find((p) => p.id === pid);
        return { playerId: pid, playerName: player?.name ?? 'Unknown' };
      });

      io.to(game.id).emit('dawn_announcement', {
        deaths,
        dayNumber: updatedGame.dayNumber,
        message: deaths.length === 0 ? 'No one died last night.' : undefined,
      });

      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('start_discussion', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('discussion_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('discussion_error', { message: 'Only the Storyteller can start discussion' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'dawn') {
        socket.emit('discussion_error', { message: 'Can only start discussion from dawn phase' });
        return;
      }

      const updatedGame = transitionDaySubPhase(game, 'discussion');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('discussion_started', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('end_discussion', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('discussion_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('discussion_error', { message: 'Only the Storyteller can end discussion' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'discussion') {
        socket.emit('discussion_error', { message: 'Can only end discussion during discussion phase' });
        return;
      }

      const updatedGame = transitionDaySubPhase(game, 'nomination');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('discussion_ended', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('open_nominations', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('nomination_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('nomination_error', { message: 'Only the Storyteller can open nominations' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'discussion') {
        socket.emit('nomination_error', { message: 'Can only open nominations from discussion phase' });
        return;
      }

      // Clear nominations from previous rounds and transition to nomination sub-phase
      let updatedGame = clearNominations(game);
      updatedGame = transitionDaySubPhase(updatedGame, 'nomination');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('nominations_opened', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('close_nominations', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('nomination_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('nomination_error', { message: 'Only the Storyteller can close nominations' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'nomination') {
        socket.emit('nomination_error', { message: 'Can only close nominations during nomination phase' });
        return;
      }

      const updatedGame = transitionDaySubPhase(game, 'end');
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('nominations_closed', { dayNumber: updatedGame.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('nominate', (data: { gameId: string; nomineeId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('nomination_error', { message: 'Game not found' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'nomination') {
        socket.emit('nomination_error', { message: 'Nominations are not open' });
        return;
      }

      // Find the nominator
      const nominator = game.players.find((p) => p.id === socket.id);
      if (!nominator) {
        socket.emit('nomination_error', { message: 'You are not in this game' });
        return;
      }

      // Dead players cannot nominate
      if (!nominator.isAlive) {
        socket.emit('nomination_error', { message: 'Dead players cannot nominate' });
        return;
      }

      // Check if nominator has already nominated today
      const hasNominated = game.nominations.some((n) => n.nominatorId === socket.id);
      if (hasNominated) {
        socket.emit('nomination_error', { message: 'You have already nominated today' });
        return;
      }

      // Find the nominee
      const nominee = game.players.find((p) => p.id === data.nomineeId);
      if (!nominee) {
        socket.emit('nomination_error', { message: 'Nominated player not found' });
        return;
      }

      // Nominee must be alive
      if (!nominee.isAlive) {
        socket.emit('nomination_error', { message: 'Cannot nominate a dead player' });
        return;
      }

      // Check if nominee has already been nominated today
      const hasBeenNominated = game.nominations.some((n) => n.nomineeId === data.nomineeId);
      if (hasBeenNominated) {
        socket.emit('nomination_error', { message: 'That player has already been nominated today' });
        return;
      }

      // Cannot nominate yourself
      if (socket.id === data.nomineeId) {
        socket.emit('nomination_error', { message: 'You cannot nominate yourself' });
        return;
      }

      let updatedGame = addNomination(game, socket.id, data.nomineeId);
      const nominationIndex = updatedGame.nominations.length - 1;

      // Automatically start a vote on this nomination
      updatedGame = startVote(updatedGame, nominationIndex);
      store.games.set(game.id, updatedGame);

      const nominatorName = nominator.name;
      const nomineeName = nominee.name;

      io.to(game.id).emit('nomination_made', {
        nominatorId: socket.id,
        nominatorName,
        nomineeId: data.nomineeId,
        nomineeName,
      });
      io.to(game.id).emit('vote_started', {
        nominationIndex,
        nomineeId: data.nomineeId,
        nomineeName,
        nominatorId: socket.id,
        nominatorName,
      });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('submit_vote', (data: { gameId: string; vote: boolean }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('vote_error', { message: 'Game not found' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'vote') {
        socket.emit('vote_error', { message: 'No vote is currently in progress' });
        return;
      }

      const { activeNominationIndex } = game;
      if (activeNominationIndex === null) {
        socket.emit('vote_error', { message: 'No active nomination to vote on' });
        return;
      }

      const player = game.players.find((p) => p.id === socket.id);
      if (!player) {
        socket.emit('vote_error', { message: 'You are not in this game' });
        return;
      }

      // Dead players can only vote yes if they have a ghost vote
      if (!player.isAlive) {
        if (!data.vote) {
          // Dead players abstaining is fine - just record submission
        } else if (player.ghostVoteUsed) {
          socket.emit('vote_error', { message: 'You have already used your ghost vote' });
          return;
        }
      }

      const nomination = game.nominations[activeNominationIndex];
      if (nomination.votesSubmitted.includes(socket.id)) {
        socket.emit('vote_error', { message: 'You have already voted' });
        return;
      }

      const updatedGame = recordVote(game, activeNominationIndex, socket.id, data.vote);
      store.games.set(game.id, updatedGame);

      socket.emit('vote_recorded', { playerId: socket.id, vote: data.vote });

      // Check if all eligible players have voted
      const updatedNomination = updatedGame.nominations[activeNominationIndex];
      const eligibleVoters = updatedGame.players.filter((p) => {
        if (p.isAlive) return true;
        const originalPlayer = game.players.find((gp) => gp.id === p.id);
        return originalPlayer && !originalPlayer.ghostVoteUsed;
      });
      const allVoted = eligibleVoters.every((p) => updatedNomination.votesSubmitted.includes(p.id));

      if (allVoted) {
        // Auto-reveal when all votes are in
        const resolved = resolveVote(updatedGame, activeNominationIndex);
        store.games.set(game.id, resolved);

        const resolvedNomination = resolved.nominations[activeNominationIndex];
        io.to(game.id).emit('vote_result', {
          nominationIndex: activeNominationIndex,
          votes: resolvedNomination.votes,
          voteCount: resolvedNomination.voteCount,
          passed: resolvedNomination.passed,
          threshold: Math.ceil(resolved.players.filter((p) => p.isAlive).length / 2),
        });
        io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(resolved));
      }
    });

    socket.on('reveal_votes', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('vote_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('vote_error', { message: 'Only the Storyteller can reveal votes' });
        return;
      }

      if (game.phase !== 'day' || game.daySubPhase !== 'vote') {
        socket.emit('vote_error', { message: 'No vote is currently in progress' });
        return;
      }

      const { activeNominationIndex } = game;
      if (activeNominationIndex === null) {
        socket.emit('vote_error', { message: 'No active nomination' });
        return;
      }

      const resolved = resolveVote(game, activeNominationIndex);
      store.games.set(game.id, resolved);

      const resolvedNomination = resolved.nominations[activeNominationIndex];
      io.to(game.id).emit('vote_result', {
        nominationIndex: activeNominationIndex,
        votes: resolvedNomination.votes,
        voteCount: resolvedNomination.voteCount,
        passed: resolvedNomination.passed,
        threshold: Math.ceil(resolved.players.filter((p) => p.isAlive).length / 2),
      });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(resolved));
    });

    socket.on('resolve_execution', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('execution_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('execution_error', { message: 'Only the Storyteller can resolve execution' });
        return;
      }

      if (game.phase !== 'day') {
        socket.emit('execution_error', { message: 'Can only resolve execution during the day phase' });
        return;
      }

      // Resolve the execution based on nomination results
      let updatedGame = resolveExecution(game);

      // Transition to execution sub-phase to announce result
      if (updatedGame.phase !== 'ended') {
        updatedGame = { ...updatedGame, daySubPhase: 'execution' as const };
      }

      store.games.set(game.id, updatedGame);

      const executedPlayer = updatedGame.executedPlayerId
        ? updatedGame.players.find((p) => p.id === updatedGame.executedPlayerId)
        : null;

      io.to(game.id).emit('execution_result', {
        executed: executedPlayer
          ? { playerId: executedPlayer.id, playerName: executedPlayer.name }
          : null,
        reason: updatedGame.executedPlayerId === null
          ? (updatedGame.gameLog[updatedGame.gameLog.length - 1]?.type === 'execution_tie' ? 'tie' : 'no_passing_nominations')
          : 'executed',
      });

      // If the game ended, send the final state with all roles revealed
      if (updatedGame.phase === 'ended') {
        io.to(game.id).emit('game_over', {
          winner: updatedGame.winner,
          players: updatedGame.players.map((p) => ({
            playerId: p.id,
            playerName: p.name,
            trueRole: p.trueRole,
            isAlive: p.isAlive,
          })),
        });
        io.to(game.id).emit('game_state', updatedGame);
      } else {
        io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
      }
    });

    socket.on('end_day', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('end_day_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('end_day_error', { message: 'Only the Storyteller can end the day' });
        return;
      }

      if (game.phase !== 'day') {
        socket.emit('end_day_error', { message: 'Can only end the day during the day phase' });
        return;
      }

      // End Day is only available after nominations are closed (daySubPhase === 'end' or 'execution')
      if (game.daySubPhase !== 'end' && game.daySubPhase !== 'execution') {
        socket.emit('end_day_error', { message: 'Must close nominations before ending the day' });
        return;
      }

      const updatedGame = transitionToNight(game);
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('night_started', { dayNumber: game.dayNumber });
      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));

      // Send the first night prompt to the Storyteller
      if (updatedGame.storytellerId) {
        const prompt = getNightPromptInfo(updatedGame);
        if (prompt) {
          io.to(updatedGame.storytellerId).emit('night_prompt', prompt);
        } else {
          io.to(updatedGame.storytellerId).emit('night_queue_empty', {});
        }
      }
    });

    socket.on('submit_night_action', (data: { gameId: string; input?: unknown }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('night_action_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('night_action_error', { message: 'Only the Storyteller can submit night actions' });
        return;
      }

      if (game.phase !== 'night') {
        socket.emit('night_action_error', { message: 'Can only submit night actions during the night phase' });
        return;
      }

      if (game.nightQueuePosition >= game.nightQueue.length) {
        socket.emit('night_action_error', { message: 'Night queue is already complete' });
        return;
      }

      // Process role-specific effects before advancing the queue
      const currentEntry = game.nightQueue[game.nightQueuePosition];
      let processedGame = game;

      if (currentEntry.roleId === 'poisoner') {
        const input = data.input as { targetPlayerId?: string } | undefined;
        if (input?.targetPlayerId) {
          // Only apply poison if the Poisoner is not themselves poisoned
          const poisoner = processedGame.players.find((p) => p.id === currentEntry.playerId);
          if (poisoner && !poisoner.isPoisoned) {
            processedGame = processPoisonerAction(processedGame, input.targetPlayerId);
          }
        }
      }

      const updatedGame = advanceNightQueue(processedGame, data.input);
      store.games.set(game.id, updatedGame);

      // Send confirmation of the completed action
      const completedEntry = game.nightQueue[game.nightQueuePosition];
      socket.emit('night_action_confirmed', {
        queuePosition: game.nightQueuePosition,
        roleId: completedEntry.roleId,
        playerId: completedEntry.playerId,
      });

      // Send updated Grimoire to Storyteller (reflects poison status changes etc.)
      const grimoire = updatedGame.players.map((p) => {
        const trueMeta = ROLE_MAP.get(p.trueRole);
        const apparentMeta = ROLE_MAP.get(p.apparentRole);
        return {
          playerId: p.id,
          playerName: p.name,
          trueRole: trueMeta ? { id: trueMeta.id, name: trueMeta.name, team: trueMeta.team, ability: trueMeta.ability } : null,
          apparentRole: apparentMeta ? { id: apparentMeta.id, name: apparentMeta.name, team: apparentMeta.team, ability: apparentMeta.ability } : null,
          isAlive: p.isAlive,
          isPoisoned: p.isPoisoned,
          isDrunk: p.isDrunk,
        };
      });
      socket.emit('grimoire', {
        players: grimoire,
        fortuneTellerRedHerringId: updatedGame.fortuneTellerRedHerringId,
      });

      // Send the next prompt or signal queue completion
      const nextPrompt = getNightPromptInfo(updatedGame);
      if (nextPrompt) {
        socket.emit('night_prompt', nextPrompt);
      } else {
        socket.emit('night_queue_empty', {});
      }
    });

    socket.on('end_night', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('end_night_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('end_night_error', { message: 'Only the Storyteller can end the night' });
        return;
      }

      if (game.phase !== 'night') {
        socket.emit('end_night_error', { message: 'Can only end night during the night phase' });
        return;
      }

      // Commit night actions (makes them permanent in the game log)
      let updatedGame = commitNightActions(game);

      // Resolve dawn deaths and transition to day
      updatedGame = resolveDawnDeaths(updatedGame);
      store.games.set(game.id, updatedGame);

      // Build dawn announcement
      const deaths = game.pendingDeaths.map((pid) => {
        const player = game.players.find((p) => p.id === pid);
        return { playerId: pid, playerName: player?.name ?? 'Unknown' };
      });

      io.to(game.id).emit('night_ended', {
        dayNumber: updatedGame.dayNumber,
      });

      io.to(game.id).emit('dawn_announcement', {
        deaths,
        dayNumber: updatedGame.dayNumber,
        message: deaths.length === 0 ? 'No one died last night.' : undefined,
      });

      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('undo_night_action', (data: { gameId: string }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('night_action_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('night_action_error', { message: 'Only the Storyteller can undo night actions' });
        return;
      }

      if (game.phase !== 'night') {
        socket.emit('night_action_error', { message: 'Can only undo night actions during the night phase' });
        return;
      }

      if (game.nightQueuePosition <= 0) {
        socket.emit('night_action_error', { message: 'No night actions to undo' });
        return;
      }

      const updatedGame = revertNightQueueStep(game);
      store.games.set(game.id, updatedGame);

      // Send the reverted prompt back to the Storyteller
      const prompt = getNightPromptInfo(updatedGame);
      if (prompt) {
        socket.emit('night_prompt', prompt);
      }

      socket.emit('night_action_reverted', {
        queuePosition: updatedGame.nightQueuePosition,
      });
    });

    socket.on('storyteller_override', (data: { gameId: string; override: StorytellerOverride }) => {
      const game = store.games.get(data.gameId);

      if (!game) {
        socket.emit('override_error', { message: 'Game not found' });
        return;
      }

      if (game.storytellerId !== socket.id) {
        socket.emit('override_error', { message: 'Only the Storyteller can apply overrides' });
        return;
      }

      // Overrides can only be applied during active game phases (not lobby or ended)
      const { phase } = game;
      if (phase === 'lobby' || phase === 'ended') {
        socket.emit('override_error', { message: 'Cannot apply overrides in current phase' });
        return;
      }

      const updatedGame = applyStorytellerOverride(game, data.override);

      // If applyStorytellerOverride returned the same reference, the override was invalid
      if (updatedGame === game) {
        socket.emit('override_error', { message: 'Invalid override' });
        return;
      }

      store.games.set(game.id, updatedGame);

      socket.emit('override_applied', {
        overrideType: data.override.type,
        playerId: data.override.playerId,
      });

      // Send updated Grimoire to Storyteller
      const grimoire = updatedGame.players.map((p) => {
        const trueMeta = ROLE_MAP.get(p.trueRole);
        const apparentMeta = ROLE_MAP.get(p.apparentRole);
        return {
          playerId: p.id,
          playerName: p.name,
          trueRole: trueMeta ? { id: trueMeta.id, name: trueMeta.name, team: trueMeta.team, ability: trueMeta.ability } : null,
          apparentRole: apparentMeta ? { id: apparentMeta.id, name: apparentMeta.name, team: apparentMeta.team, ability: apparentMeta.ability } : null,
          isAlive: p.isAlive,
          isPoisoned: p.isPoisoned,
          isDrunk: p.isDrunk,
        };
      });
      socket.emit('grimoire', {
        players: grimoire,
        fortuneTellerRedHerringId: updatedGame.fortuneTellerRedHerringId,
      });

      io.to(game.id).emit('game_state', sanitizeGameStateForPlayer(updatedGame));
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);

      const game = findGameByPlayerId(store, socket.id);
      if (!game) return;

      // Only remove from lobby; in-game disconnects are handled differently
      if (game.phase !== 'lobby') return;

      const updatedGame = removePlayer(game, socket.id);
      store.games.set(game.id, updatedGame);

      io.to(game.id).emit('player_left', { playerId: socket.id });
      io.to(game.id).emit('game_state', updatedGame);
    });
  });
}
