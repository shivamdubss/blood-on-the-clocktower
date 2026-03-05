import React from 'react';
import type { Player } from '../../types/game.js';

export function PlayerList({ players, currentPlayerId }: { players: Player[]; currentPlayerId: string | null }): React.ReactElement {
  return (
    <div data-testid="player-list">
      <h3 className="text-sm font-medium text-gray-400 mb-2">Players</h3>
      <ul className="space-y-1">
        {players.map((p) => (
          <li
            key={p.id}
            className={`flex items-center justify-between px-3 py-1.5 rounded ${
              p.isAlive
                ? 'bg-gray-700 text-white'
                : 'bg-gray-800 text-gray-500 line-through'
            }`}
            data-testid={`player-${p.id}`}
            data-alive={p.isAlive}
          >
            <span>
              {p.name}
              {p.id === currentPlayerId && (
                <span className="text-xs text-blue-400 ml-1">(you)</span>
              )}
            </span>
            {!p.isAlive && (
              <span className="text-xs text-red-400 no-underline" data-testid="dead-marker">Dead</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
