import React from 'react';
import { useStore } from './store.js';

export function App(): React.ReactElement {
  const gameState = useStore((s) => s.gameState);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Blood on the Clocktower</h1>
        {gameState ? (
          <p>Game: {gameState.id} | Phase: {gameState.phase}</p>
        ) : (
          <p className="text-gray-400">Loading...</p>
        )}
      </div>
    </div>
  );
}

export default App;
