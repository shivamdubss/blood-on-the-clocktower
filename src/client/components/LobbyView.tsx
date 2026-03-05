import React from 'react';
import { useStore } from '../store.js';

export function LobbyView(): React.ReactElement {
  const gameState = useStore((s) => s.gameState);
  const playerId = useStore((s) => s.playerId);
  const gameId = useStore((s) => s.gameId);
  const socket = useStore((s) => s.socket);

  if (!gameState) return <div>Loading...</div>;

  const isStoryteller = playerId === gameState.storytellerId;

  const handleStartGame = () => {
    if (!socket || !gameId) return;
    socket.emit('start_game', { gameId });
  };

  const playerCount = gameState.players.length;
  const canStart = playerCount >= 5 && playerCount <= 15;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md shadow-xl text-center">
        <h2 className="text-2xl font-bold mb-2">Lobby</h2>
        <p className="text-gray-400 mb-4">
          Join Code: <span className="text-white font-mono text-lg" data-testid="lobby-join-code">{gameState.joinCode}</span>
        </p>
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-400 mb-2">
            Players ({gameState.players.length})
          </h3>
          <ul className="space-y-1" data-testid="lobby-player-list">
            {gameState.players.map((p) => (
              <li key={p.id} className="bg-gray-700 rounded px-3 py-1">
                {p.name}
                {p.id === gameState.storytellerId && (
                  <span className="ml-2 text-xs text-purple-400">(Storyteller)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        {isStoryteller ? (
          <div className="space-y-2">
            {!canStart && (
              <p className="text-yellow-400 text-sm">
                Need 5–15 players to start ({playerCount} joined)
              </p>
            )}
            <button
              onClick={handleStartGame}
              disabled={!canStart}
              className="w-full py-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 rounded font-medium transition-colors"
              data-testid="start-game-button"
            >
              Start Game
            </button>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Waiting for the Storyteller to start the game...</p>
        )}
      </div>
    </div>
  );
}
