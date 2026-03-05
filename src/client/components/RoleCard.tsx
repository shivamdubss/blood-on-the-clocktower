import React from 'react';
import type { RoleInfo } from '../store.js';

const TEAM_COLORS: Record<string, string> = {
  townsfolk: 'border-blue-500 bg-blue-900/30',
  outsider: 'border-teal-500 bg-teal-900/30',
  minion: 'border-orange-500 bg-orange-900/30',
  demon: 'border-red-500 bg-red-900/30',
};

const TEAM_LABELS: Record<string, string> = {
  townsfolk: 'Townsfolk',
  outsider: 'Outsider',
  minion: 'Minion',
  demon: 'Demon',
};

export function RoleCard({ roleInfo }: { roleInfo: RoleInfo }): React.ReactElement {
  const colorClass = TEAM_COLORS[roleInfo.team] ?? 'border-gray-500 bg-gray-900/30';
  const teamLabel = TEAM_LABELS[roleInfo.team] ?? roleInfo.team;

  return (
    <div
      className={`border-2 rounded-lg p-4 ${colorClass}`}
      data-testid="role-card"
    >
      <div className="text-center">
        <h3 className="text-xl font-bold" data-testid="role-name">{roleInfo.name}</h3>
        <p className="text-sm text-gray-300 mt-1" data-testid="role-team">{teamLabel}</p>
        <p className="text-sm text-gray-400 mt-2 italic" data-testid="role-ability">{roleInfo.ability}</p>
      </div>
    </div>
  );
}
