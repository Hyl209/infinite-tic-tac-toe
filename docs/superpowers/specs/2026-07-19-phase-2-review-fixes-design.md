# Phase 2 Review Fixes Design

## Goal

Repair the three verified regressions in the phase-2 friends and game-invite branch without changing unrelated behavior, then make the branch safe to merge into `main`.

## Design

### Migration history

Restore `20260723_stats_history_ambiguity.sql` to its original version. Rename the new social migration to `20260725_social.sql`, leaving the version already present on `main` immutable and avoiding the documented future `20260724_shop.sql` slot.

### Username compatibility

Six-digit numeric usernames remain reserved for new accounts, but existing accounts keep working. The browser registration path continues to reject the reserved pattern; login validation accepts it and still validates the normal username alphabet and length. The database migration replaces the immediate CHECK constraint with a trigger that rejects six-digit numeric usernames only on profile INSERT or username changes. Updating an existing legacy profile's game name therefore remains valid.

### Realtime isolation

Each `FriendsClient` gets a module-local monotonically increasing channel suffix and subscribes to `player-social:<suffix>`. This follows the existing `room:<id>` topic pattern and keeps separate modules independently subscribable and removable. No shared-client refactor is introduced.

## Testing

- Add an account regression test proving a legacy six-digit username can log in while registration still rejects it.
- Add a migration regression test proving the immutable migration version and username trigger contract.
- Add a FriendsClient regression test proving independent clients use distinct topics and can subscribe/clean up independently.
- Run the targeted tests after each red-green cycle, then run the complete Node test suite.

## Merge scope

Commit the fixes on the current feature branch and merge that commit into the local `main` branch. Do not push to `origin` unless separately requested.
