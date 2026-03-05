// Role distribution table from PRD section 5.1
export interface Distribution {
  players: number;
  townsfolk: number;
  outsiders: number;
  minions: number;
  demons: number;
}

export const DISTRIBUTION_TABLE: Distribution[] = [
  { players: 5,  townsfolk: 3, outsiders: 0, minions: 1, demons: 1 },
  { players: 6,  townsfolk: 3, outsiders: 1, minions: 1, demons: 1 },
  { players: 7,  townsfolk: 5, outsiders: 0, minions: 1, demons: 1 },
  { players: 8,  townsfolk: 5, outsiders: 1, minions: 1, demons: 1 },
  { players: 9,  townsfolk: 5, outsiders: 2, minions: 1, demons: 1 },
  { players: 10, townsfolk: 7, outsiders: 0, minions: 2, demons: 1 },
  { players: 11, townsfolk: 7, outsiders: 1, minions: 2, demons: 1 },
  { players: 12, townsfolk: 7, outsiders: 2, minions: 2, demons: 1 },
  { players: 13, townsfolk: 9, outsiders: 0, minions: 3, demons: 1 },
  { players: 14, townsfolk: 9, outsiders: 1, minions: 3, demons: 1 },
  { players: 15, townsfolk: 9, outsiders: 2, minions: 3, demons: 1 },
];

export function getDistribution(playerCount: number): Distribution | undefined {
  return DISTRIBUTION_TABLE.find((d) => d.players === playerCount);
}
