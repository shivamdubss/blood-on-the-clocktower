import React, { useState } from 'react';
import { useStore } from '../store.js';

export function JoinScreen(): React.ReactElement {
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const joinGame = useStore((s) => s.joinGame);
  const connect = useStore((s) => s.connect);
  const joinError = useStore((s) => s.joinError);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || !playerName.trim()) return;
    connect();
    // Small delay to ensure socket is connected before joining
    setTimeout(() => {
      useStore.getState().joinGame(joinCode.trim().toUpperCase(), playerName.trim());
    }, 100);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md shadow-xl">
        <h1 className="text-3xl font-bold text-center mb-6">Blood on the Clocktower</h1>
        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label htmlFor="joinCode" className="block text-sm font-medium text-gray-300 mb-1">
              Join Code
            </label>
            <input
              id="joinCode"
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter 6-character code"
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              maxLength={6}
              data-testid="join-code-input"
            />
          </div>
          <div>
            <label htmlFor="playerName" className="block text-sm font-medium text-gray-300 mb-1">
              Your Name
            </label>
            <input
              id="playerName"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your display name"
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              data-testid="player-name-input"
            />
          </div>
          {joinError && (
            <p className="text-red-400 text-sm" data-testid="join-error">{joinError}</p>
          )}
          <button
            type="submit"
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition-colors"
            data-testid="join-button"
          >
            Join Game
          </button>
        </form>
      </div>
    </div>
  );
}
