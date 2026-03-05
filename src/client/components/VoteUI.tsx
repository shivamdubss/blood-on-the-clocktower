import React from 'react';
import { useStore } from '../store.js';

export function VoteUI(): React.ReactElement {
  const currentVote = useStore((s) => s.currentVote);
  const lastVoteResult = useStore((s) => s.lastVoteResult);
  const hasVoted = useStore((s) => s.hasVoted);
  const submitVote = useStore((s) => s.submitVote);
  const lastExecutionResult = useStore((s) => s.lastExecutionResult);

  return (
    <div data-testid="vote-ui" className="space-y-3">
      {currentVote && (
        <div className="bg-gray-700 rounded-lg p-4" data-testid="active-vote">
          <p className="text-sm text-gray-300 mb-2">
            <span className="font-medium text-white">{currentVote.nominatorName}</span>
            {' nominated '}
            <span className="font-medium text-white">{currentVote.nomineeName}</span>
          </p>
          {!hasVoted ? (
            <div className="flex gap-2">
              <button
                onClick={() => submitVote(true)}
                className="flex-1 py-2 bg-green-600 hover:bg-green-700 rounded font-medium transition-colors"
                data-testid="vote-yes"
              >
                Vote Yes
              </button>
              <button
                onClick={() => submitVote(false)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded font-medium transition-colors"
                data-testid="vote-no"
              >
                Vote No
              </button>
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center" data-testid="vote-submitted">
              Vote submitted. Waiting for others...
            </p>
          )}
        </div>
      )}

      {lastVoteResult && (
        <div className="bg-gray-700 rounded-lg p-4" data-testid="vote-result">
          <p className="text-sm">
            Votes: <span className="font-bold">{lastVoteResult.voteCount}</span>
            {' / '}
            <span>{lastVoteResult.threshold} needed</span>
            {' — '}
            <span className={lastVoteResult.passed ? 'text-green-400' : 'text-red-400'}>
              {lastVoteResult.passed ? 'PASSED' : 'FAILED'}
            </span>
          </p>
        </div>
      )}

      {lastExecutionResult && (
        <div className="bg-gray-700 rounded-lg p-4" data-testid="execution-result">
          {lastExecutionResult.executed ? (
            <p className="text-sm">
              <span className="font-medium text-red-400">{lastExecutionResult.executed.playerName}</span>
              {' has been executed.'}
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              No execution today ({lastExecutionResult.reason}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
