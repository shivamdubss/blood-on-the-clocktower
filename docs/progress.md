# BotC -- Progress Log

## Current State
- **Current Milestone:** Milestone 1 (Foundation)
- **Features Completed:** 2 / 52 (LOBBY-01, LOBBY-02)
- **Last Known Working State:** All tests passing (21 unit, 10 e2e)
- **Last Session:** Session 2

## Session Log

### Session 2 -- LOBBY-02
- Completed `join_game` WebSocket handler: validates join code, checks game phase, rejects duplicate names, adds player to game state via `addPlayer()` state machine function
- Changed error event name from `error` to `join_error` to avoid conflict with Socket.io's built-in `error` event
- Player gets `game_joined` (with gameId + playerId) and `game_state` events on successful join
- Host/other players get `player_joined` and `game_state` events in real time
- Player object initialized with default values (isAlive: true, placeholder role, seatIndex based on join order)
- Added 7 unit tests in `joinGame.test.ts` and 5 e2e tests in `joinLobby.spec.ts`

### Session 1 -- LOBBY-01
- Implemented `POST /api/game` endpoint with unique 6-character alphanumeric join code
- Join code uses charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous chars I/1/O/0)
- Uniqueness enforced by checking existing active games before issuing code
- Response includes `wsUrl` for WebSocket connection
- Exported `store` from `index.ts` for testability
- Added unit tests (5 tests in `gameCreation.test.ts`) and e2e tests (3 tests in `createGame.spec.ts`)
- Note: `npm run test:unit` already includes `--run` flag; do not pass `--run` again via `--`

### Session 0 -- Initializer
- Set up repo structure, installed dependencies, created scaffolding files.
- No features implemented. Ready for Milestone 1.

## Decisions

- Join code charset excludes ambiguous characters (I, 1, O, 0) for readability
- `PORT` const moved above its first usage in index.ts
- Use `join_error` event (not `error`) for socket error responses to avoid Socket.io reserved event conflict

## Known Issues

(none)

## Human Review Items

(none)
