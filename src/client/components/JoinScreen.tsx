import React, { useState } from 'react';
import { useStore } from '../store.js';

export function JoinScreen(): React.ReactElement {
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const joinGame = useStore((s) => s.joinGame);
  const connect = useStore((s) => s.connect);
  const joinError = useStore((s) => s.joinError);

  const [hostJoinCode, setHostJoinCode] = useState<string | null>(null);
  const [hostSecret, setHostSecret] = useState<string | null>(null);
  const [hostWsUrl, setHostWsUrl] = useState<string | null>(null);
  const [hostName, setHostName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || !playerName.trim()) return;
    connect();
    // Small delay to ensure socket is connected before joining
    setTimeout(() => {
      useStore.getState().joinGame(joinCode.trim().toUpperCase(), playerName.trim());
    }, 100);
  };

  const handleHost = async () => {
    setIsCreating(true);
    setHostError(null);
    try {
      const res = await fetch('/api/game', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create game');
      const data = (await res.json()) as { joinCode: string; hostSecret: string; wsUrl: string };
      setHostJoinCode(data.joinCode);
      setHostSecret(data.hostSecret);
      setHostWsUrl(data.wsUrl);
    } catch {
      setHostError('Could not create game. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinAsStoryteller = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostName.trim() || !hostJoinCode || !hostSecret) return;
    const socket = connect(hostWsUrl ?? undefined);
    const code = hostJoinCode;
    const name = hostName.trim();
    const secret = hostSecret;
    const delay = socket.connected ? 0 : 100;
    setTimeout(() => {
      useStore.getState().joinGame(code, name, secret);
    }, delay);
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

        <div className="mt-6 pt-6 border-t border-gray-700">
          {!hostJoinCode ? (
            <>
              {hostError && (
                <p className="text-red-400 text-sm mb-3" data-testid="host-error">{hostError}</p>
              )}
              <button
                onClick={handleHost}
                disabled={isCreating}
                className="w-full py-2 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 rounded font-medium transition-colors"
                data-testid="host-button"
              >
                {isCreating ? 'Creating...' : 'Host a Game'}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-400 mb-1">Share this code with players:</p>
                <p
                  className="text-4xl font-mono font-bold tracking-widest text-center text-yellow-400 bg-gray-900 rounded py-3"
                  data-testid="host-join-code"
                >
                  {hostJoinCode}
                </p>
              </div>
              <form onSubmit={handleJoinAsStoryteller} className="space-y-3">
                <div>
                  <label htmlFor="hostName" className="block text-sm font-medium text-gray-300 mb-1">
                    Your Name (Storyteller)
                  </label>
                  <input
                    id="hostName"
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="Enter your display name"
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    data-testid="host-name-input"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 bg-green-700 hover:bg-green-800 rounded font-medium transition-colors"
                  data-testid="join-as-storyteller-button"
                >
                  Join as Storyteller
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
