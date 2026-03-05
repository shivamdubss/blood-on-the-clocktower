import React from 'react';
import type { GameState } from '../../types/game.js';

const PHASE_CONFIG: Record<string, { label: string; bgClass: string; icon: string }> = {
  setup: { label: 'Setup', bgClass: 'bg-purple-700', icon: '' },
  day: { label: 'Day', bgClass: 'bg-yellow-600', icon: '' },
  night: { label: 'Night', bgClass: 'bg-indigo-800', icon: '' },
  ended: { label: 'Game Over', bgClass: 'bg-gray-700', icon: '' },
};

const SUB_PHASE_LABELS: Record<string, string> = {
  dawn: 'Dawn',
  discussion: 'Discussion',
  nomination: 'Nominations Open',
  vote: 'Voting',
  execution: 'Execution',
  end: 'Day Ending',
};

export function PhaseIndicator({ gameState }: { gameState: GameState }): React.ReactElement {
  const config = PHASE_CONFIG[gameState.phase] ?? { label: gameState.phase, bgClass: 'bg-gray-700', icon: '' };
  const subPhaseLabel = gameState.daySubPhase ? SUB_PHASE_LABELS[gameState.daySubPhase] : null;

  return (
    <div className={`${config.bgClass} rounded-lg px-4 py-2 text-center`} data-testid="phase-indicator">
      <span className="font-bold text-lg" data-testid="phase-label">
        {config.label} {gameState.dayNumber > 0 ? gameState.dayNumber : ''}
      </span>
      {subPhaseLabel && (
        <span className="ml-2 text-sm text-gray-200" data-testid="sub-phase-label">
          — {subPhaseLabel}
        </span>
      )}
    </div>
  );
}
