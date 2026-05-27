# fix/session-title-preservation

This task shipped the minimal release-safe naming fix that preserves explicit session titles.

## Problem

Session titles provided at creation were being overwritten automatically when the first turn completed.

That broke the basic expectation that:

- a user-provided title stays stable
- later runtime behavior should not silently rename the session

## Goal

Ship the smallest correct fix before release:

1. preserve explicit titles
2. keep first-prompt auto-titling only for effectively unnamed sessions
3. avoid widening scope into full rename/title-ownership work

## Implemented behavior

- sessions created with an explicit title keep that title after the first turn
- this now holds for both:
  - model-only turns
  - tool-enabled turns
- sessions still using the default placeholder title may still be auto-titled from the first prompt
- later turns do not keep renaming the session

## Implementation notes

- backend-only change
- introduced a small shared helper for first-turn auto-titling eligibility
- auto-titling now runs only when the current title is still `New session`
- no schema migration
- no CLI rename command
- no UI redesign

## Regression coverage

- explicit title survives first model-only turn
- explicit title survives first tool-enabled turn
- unnamed session auto-titles from first prompt
- later turns do not replace the first derived title

## Result

The release blocker is fixed without expanding scope. Explicit session titles are now stable, while simple auto-titling still works for sessions that were never named by the user.
