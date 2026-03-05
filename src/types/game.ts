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
  votesSubmitted: string[];
  voteCount: number;
  passed: boolean;
}

export interface NightQueueEntry {
  roleId: RoleId;
  playerId: string;
  completed: boolean;
  result?: unknown;
  storytellerInput?: unknown;
}

export interface GrimoirePlayerInfo {
  playerId: string;
  playerName: string;
  trueRole: { id: RoleId; name: string; team: string; ability: string } | null;
  apparentRole: { id: RoleId; name: string; team: string; ability: string } | null;
  isAlive: boolean;
  isPoisoned: boolean;
  isDrunk: boolean;
}

export interface GrimoireData {
  players: GrimoirePlayerInfo[];
  fortuneTellerRedHerringId: string | null;
}

export interface NightPromptInfo {
  queuePosition: number;
  totalInQueue: number;
  roleId: RoleId;
  roleName: string;
  ability: string;
  playerId: string;
  playerName: string;
  isDrunk: boolean;
  isPoisoned: boolean;
  promptType: 'choose_player' | 'choose_two_players' | 'provide_number' | 'choose_players_and_role' | 'provide_role' | 'choose_player_and_provide_role' | 'info_only';
  promptDescription: string;
  grimoireData?: GrimoireData;
  executedPlayerInfo?: {
    playerId: string;
    playerName: string;
    trueRole: string;
  };
  ravenkeeperKilledTonight?: boolean;
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
  activeNominationIndex: number | null;
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

export type OverrideType =
  | 'kill_player'
  | 'revive_player'
  | 'set_poison'
  | 'clear_poison'
  | 'add_pending_death'
  | 'remove_pending_death'
  | 'modify_night_action'
  | 'set_player_role';

export interface StorytellerOverride {
  type: OverrideType;
  playerId?: string;
  queuePosition?: number;
  storytellerInput?: unknown;
  roleId?: RoleId;
  apparentRole?: RoleId;
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
