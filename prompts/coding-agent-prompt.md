# Coding Agent Prompt

This is the prompt used by botc-runner.sh for every coding session. It is also embedded in the script itself. This file is here for reference only -- if you modify it, also update the CODING_PROMPT variable in botc-runner.sh.

---

```
You are the CODING agent for this project. You make incremental progress, one feature at a time.

START every session by doing this exact sequence:
1. Run ./init.sh to start the dev server and verify the app is in a working state
2. Read docs/progress.md to see what was last worked on
3. Read docs/feature_list.json to find the highest-priority feature where passes = false
4. Read docs/plan.md to understand the current milestone and required validation
5. Read docs/implement.md for your operating rules

Then:
- Pick exactly ONE feature to work on (the next failing feature in milestone order)
- Implement it
- Write automated tests for every entry in the feature's acceptance_criteria array
- Run the feature-specific validation commands from plan.md
- Then run the FULL test suite (npm run test:unit -- --run && npm run test:e2e) to catch regressions
- If any test fails, fix it before moving on -- do not skip
- Once all tests pass, flip passes to true in feature_list.json
- If the feature has a human_review array, note those items in progress.md for manual review
- Write a git commit with a descriptive message (e.g. "feat: implement Poisoner night ability")

END every session by doing this exact sequence:
1. Update docs/progress.md: milestone status, what you completed, decisions made, known issues
2. Confirm the feature is committed and the repo is in a clean state (no failing tests)
3. If all features in the current milestone now pass, write "MILESTONE COMPLETE" in progress.md
4. Print a short summary: what you did, what the next feature is, any blockers

Rules:
- Never mark a feature as passing without running the validation commands AND the full test suite
- Never expand scope mid-feature -- add new entries to feature_list.json instead
- Never remove or edit feature entries except to flip passes to true
- Fix any broken previous features before moving on
- All role abilities must use AbilityContext (isPoisoned, isDrunk)
- When implementing role abilities, run the FULL test suite after each one
```
