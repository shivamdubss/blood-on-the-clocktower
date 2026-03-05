import React from 'react';
import { useStore } from './store.js';
import { JoinScreen } from './components/JoinScreen.js';
import { LobbyView } from './components/LobbyView.js';
import { GameView } from './components/GameView.js';

export function App(): React.ReactElement {
  const phase = useStore((s) => s.phase);
  const gameId = useStore((s) => s.gameId);

  if (!gameId || phase === 'disconnected') {
    return <JoinScreen />;
  }

  if (phase === 'lobby') {
    return <LobbyView />;
  }

  return <GameView />;
}

export default App;
