# BotC -- Progress Log

## Current State
- **Current Milestone:** Milestone 1 (Foundation)
- **Features Completed:** 1 / 52 (LOBBY-01)
- **Last Known Working State:** All tests passing (14 unit, 5 e2e)
- **Last Session:** Session 1

## Session Log

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

## Known Issues

(none)

## Human Review Items

(none)
