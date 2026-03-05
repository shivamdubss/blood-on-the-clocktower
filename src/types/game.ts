export type Team = 'townsfolk' | 'outsider' | 'minion' | 'demon';

export type RoleType = 'townsfolk' | 'outsider' | 'minion' | 'demon';

export type Phase = 'lobby' | 'setup' | 'day' | 'night' | 'ended';

export type DaySubPhase = 'dawn' | 'discussion' | 'nomination' | 'vote' | 'execution' | 'end';

export type RoleId =
  | 'washerwoman'
  | 'librarian'
  | 'investigator'
  | 'chef'
  | 'empath'
  | 'fortuneTeller'
  | 'undertaker'
  | 'monk'
  | 'ravenkeeper'
  | 'virgin'
  | 'slayer'
  | 'soldier'
  | 'mayor'
  | 'butler'
  | 'drunk'
  | 'recluse'
  | 'saint'
  | 'poisoner'
  | 'spy'
  | 'scarletWoman'
  | 'baron'
  | 'imp';

export interface Player {
  id: string;
  name: string;
  trueRole: RoleId;
  apparentRole: RoleId;
  isAlive: boolean;
  isPoisoned: boolean;
  isDrunk: boolean;
  hasGhostVote: boolean;
  ghostVoteUsed: boolean;
  seatIndex: number;
}

export interface Nomination {
  nominatorId: string;
  nomineeId: string;
  votes: string[];
  voteCount: number;
  passed: boolean;
}

export interface NightQueueEntry {
  roleId: RoleId;
  playerId: string;
  completed: boolean;
  result?: unknown;
}

export interface GameState {
  id: string;
  joinCode: string;
  phase: Phase;
  daySubPhase: DaySubPhase | null;
  dayNumber: number;
  players: Player[];
  storytellerId: string | null;
  nominations: Nomination[];
  nightQueue: NightQueueEntry[];
  nightQueuePosition: number;
  executedPlayerId: string | null;
  monkProtectedPlayerId: string | null;
  fortuneTellerRedHerringId: string | null;
  demonBluffRoles: RoleId[];
  slayerAbilityUsed: boolean;
  virginAbilityUsed: boolean;
  pendingDeaths: string[];
  gameLog: GameLogEntry[];
  winner: 'good' | 'evil' | null;
  hostSecret: string;
  storytellerNotes: string;
  createdAt: number;
}

export interface GameLogEntry {
  timestamp: number;
  type: string;
  data: unknown;
}

export interface RoleMetadata {
  id: RoleId;
  name: string;
  team: Team;
  type: RoleType;
  ability: string;
  firstNight: boolean;
  otherNights: boolean;
}
