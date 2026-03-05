import React from 'react';
import { useStore } from '../store.js';
import { RoleCard } from './RoleCard.js';
import { PhaseIndicator } from './PhaseIndicator.js';
import { PlayerList } from './PlayerList.js';
import { VoteUI } from './VoteUI.js';

export function GameView(): React.ReactElement {
  const gameState = useStore((s) => s.gameState);
  const roleInfo = useStore((s) => s.roleInfo);
  const playerId = useStore((s) => s.playerId);
  const dawnAnnouncement = useStore((s) => s.dawnAnnouncement);
  const gameOver = useStore((s) => s.gameOver);

  if (!gameState) return <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Loading...</div>;

  const isNight = gameState.phase === 'night';
  const isEnded = gameState.phase === 'ended';

  return (
    <div className={`min-h-screen ${isNight ? 'bg-indigo-950' : 'bg-gray-900'} text-white transition-colors duration-500`}>
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <PhaseIndicator gameState={gameState} />

        {roleInfo && <RoleCard roleInfo={roleInfo} />}

        {/* Dawn announcement */}
        {dawnAnnouncement && gameState.daySubPhase === 'dawn' && (
          <div className="bg-gray-800 rounded-lg p-4" data-testid="dawn-announcement">
            <h3 className="font-bold mb-1">Dawn</h3>
            {dawnAnnouncement.message ? (
              <p className="text-gray-300 text-sm">{dawnAnnouncement.message}</p>
            ) : (
              <ul className="text-sm text-red-300">
                {dawnAnnouncement.deaths.map((d) => (
                  <li key={d.playerId}>{d.playerName} has died.</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Night view */}
        {isNight && (
          <div className="bg-indigo-900/50 rounded-lg p-6 text-center" data-testid="night-view">
            <p className="text-lg text-indigo-200">Night has fallen. Close your eyes...</p>
          </div>
        )}

        {/* Vote UI (during day) */}
        {gameState.phase === 'day' && <VoteUI />}

        {/* Game Over */}
        {isEnded && gameOver && (
          <div className="bg-gray-800 rounded-lg p-6 text-center" data-testid="game-over">
            <h2 className="text-2xl font-bold mb-2">
              {gameOver.winner === 'good' ? 'Good Wins!' : 'Evil Wins!'}
            </h2>
            <div className="mt-3 space-y-1 text-sm">
              {gameOver.players.map((p) => (
                <div key={p.id ?? p.playerId} className={`flex justify-between px-3 py-1 rounded ${p.isAlive ? 'bg-gray-700' : 'bg-gray-800 text-gray-500'}`}>
                  <span>{p.name ?? p.playerName}</span>
                  <span className="text-gray-400">{p.trueRole}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <PlayerList players={gameState.players} currentPlayerId={playerId} />
      </div>
    </div>
  );
}
