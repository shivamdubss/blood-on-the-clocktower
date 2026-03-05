import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type { GameState, RoleId } from '../types/game.js';

export interface RoleInfo {
  role: RoleId;
  name: string;
  team: string;
  ability: string;
}

export interface NominationEvent {
  nominatorId: string;
  nominatorName: string;
  nomineeId: string;
  nomineeName: string;
}

export interface VoteStartEvent {
  nominationIndex: number;
  nomineeId: string;
  nomineeName: string;
  nominatorId: string;
  nominatorName: string;
}

export interface VoteResultEvent {
  nominationIndex: number;
  votes: string[];
  voteCount: number;
  passed: boolean;
  threshold: number;
}

export interface ExecutionResultEvent {
  executed: { playerId: string; playerName: string } | null;
  reason: string;
}

export interface DawnAnnouncementEvent {
  deaths: Array<{ playerId: string; playerName: string }>;
  dayNumber: number;
  message?: string;
}

export interface SlayerResultEvent {
  slayerId: string;
  slayerName: string;
  targetId: string;
  targetName: string;
  targetDied: boolean;
}

export interface GameOverEvent {
  winner: 'good' | 'evil';
  players: Array<{ id?: string; playerId?: string; playerName?: string; name?: string; trueRole: RoleId; isAlive: boolean }>;
}

export interface ClientStore {
  socket: Socket | null;
  gameState: GameState | null;
  playerId: string | null;
  gameId: string | null;
  roleInfo: RoleInfo | null;
  phase: string;
  dawnAnnouncement: DawnAnnouncementEvent | null;
  currentNomination: NominationEvent | null;
  currentVote: VoteStartEvent | null;
  lastVoteResult: VoteResultEvent | null;
  lastExecutionResult: ExecutionResultEvent | null;
  lastSlayerResult: SlayerResultEvent | null;
  gameOver: GameOverEvent | null;
  joinError: string | null;
  hasVoted: boolean;

  connect: (url?: string) => Socket;
  joinGame: (joinCode: string, playerName: string, hostSecret?: string) => void;
  submitVote: (vote: boolean) => void;
  nominate: (nomineeId: string) => void;
  slayerAction: (targetPlayerId: string) => void;
  setGameState: (state: GameState) => void;
  setPlayerId: (id: string) => void;
  reset: () => void;
}

export const useStore = create<ClientStore>((set, get) => ({
  socket: null,
  gameState: null,
  playerId: null,
  gameId: null,
  roleInfo: null,
  phase: 'disconnected',
  dawnAnnouncement: null,
  currentNomination: null,
  currentVote: null,
  lastVoteResult: null,
  lastExecutionResult: null,
  lastSlayerResult: null,
  gameOver: null,
  joinError: null,
  hasVoted: false,

  connect: (url?: string) => {
    const existing = get().socket;
    if (existing?.connected) return existing;

    const socket = io(url ?? window.location.origin, {
      transports: ['websocket'],
    });

    socket.on('game_joined', (data: { gameId: string; playerId: string }) => {
      set({ gameId: data.gameId, playerId: data.playerId, joinError: null, phase: 'lobby' });
    });

    socket.on('join_error', (data: { message: string }) => {
      set({ joinError: data.message });
    });

    socket.on('game_state', (state: GameState) => {
      set({ gameState: state, phase: state.phase });
    });

    socket.on('your_role', (data: RoleInfo) => {
      set({ roleInfo: data });
    });

    socket.on('game_started', () => {
      set({ phase: 'setup' });
    });

    socket.on('dawn_announcement', (data: DawnAnnouncementEvent) => {
      set({ dawnAnnouncement: data, phase: 'day' });
    });

    socket.on('discussion_started', () => {
      // phase updated via game_state
    });

    socket.on('nomination_made', (data: NominationEvent) => {
      set({ currentNomination: data });
    });

    socket.on('vote_started', (data: VoteStartEvent) => {
      set({ currentVote: data, hasVoted: false, lastVoteResult: null });
    });

    socket.on('vote_recorded', () => {
      set({ hasVoted: true });
    });

    socket.on('vote_result', (data: VoteResultEvent) => {
      set({ lastVoteResult: data, currentVote: null });
    });

    socket.on('execution_result', (data: ExecutionResultEvent) => {
      set({ lastExecutionResult: data });
    });

    socket.on('slayer_result', (data: SlayerResultEvent) => {
      set({ lastSlayerResult: data });
    });

    socket.on('virgin_triggered', () => {
      // handled via execution_result
    });

    socket.on('night_started', () => {
      set({
        phase: 'night',
        currentNomination: null,
        currentVote: null,
        lastVoteResult: null,
        lastExecutionResult: null,
        lastSlayerResult: null,
        dawnAnnouncement: null,
        hasVoted: false,
      });
    });

    socket.on('game_over', (data: GameOverEvent) => {
      set({ gameOver: data, phase: 'ended' });
    });

    set({ socket });
    return socket;
  },

  joinGame: (joinCode: string, playerName: string, hostSecret?: string) => {
    const socket = get().socket;
    if (!socket) return;
    set({ joinError: null });
    socket.emit('join_game', { joinCode, playerName, hostSecret });
  },

  submitVote: (vote: boolean) => {
    const { socket, gameId } = get();
    if (!socket || !gameId) return;
    socket.emit('submit_vote', { gameId, vote });
  },

  nominate: (nomineeId: string) => {
    const { socket, gameId } = get();
    if (!socket || !gameId) return;
    socket.emit('nominate', { gameId, nomineeId });
  },

  slayerAction: (targetPlayerId: string) => {
    const { socket, gameId } = get();
    if (!socket || !gameId) return;
    socket.emit('slayer_action', { gameId, targetPlayerId });
  },

  setGameState: (gameState) => set({ gameState }),
  setPlayerId: (playerId) => set({ playerId }),
  reset: () => set({
    socket: null,
    gameState: null,
    playerId: null,
    gameId: null,
    roleInfo: null,
    phase: 'disconnected',
    dawnAnnouncement: null,
    currentNomination: null,
    currentVote: null,
    lastVoteResult: null,
    lastExecutionResult: null,
    lastSlayerResult: null,
    gameOver: null,
    joinError: null,
    hasVoted: false,
  }),
}));
