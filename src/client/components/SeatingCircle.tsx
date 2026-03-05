import React from 'react';
import type { Player } from '../../types/game.js';

export function SeatingCircle({
  players,
  currentPlayerId,
}: {
  players: Player[];
  currentPlayerId: string | null;
}): React.ReactElement {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  const count = sorted.length;

  return (
    <div data-testid="seating-circle" className="relative w-72 h-72 mx-auto my-4">
      {sorted.map((p, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        const radius = 42; // percent of container
        const left = 50 + radius * Math.cos(angle);
        const top = 50 + radius * Math.sin(angle);

        return (
          <div
            key={p.id}
            data-testid={`seat-${p.seatIndex}`}
            data-seat-index={p.seatIndex}
            data-alive={p.isAlive}
            data-player-id={p.id}
            className={`absolute flex items-center justify-center w-12 h-12 rounded-full text-xs font-medium text-center leading-tight -translate-x-1/2 -translate-y-1/2 ${
              p.isAlive
                ? 'bg-gray-700 text-white border-2 border-gray-500'
                : 'bg-gray-800 text-gray-500 border-2 border-red-900 line-through'
            } ${p.id === currentPlayerId ? 'ring-2 ring-blue-400' : ''}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
            }}
          >
            {p.name.length > 6 ? p.name.slice(0, 5) + '...' : p.name}
          </div>
        );
      })}
    </div>
  );
}
