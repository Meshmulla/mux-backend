# Feature Flags

This document tracks feature flags and kill-switches used across mux-backend.
Every money-path or mainnet-affecting change MUST be gated behind a flag and
have a documented rollback path (see the PR description for the specific
rollback steps).

## Conventions

- Flags are read from environment variables and default to **off** (deny-by-default).
- A flag must be safe to flip at runtime without a redeploy where possible.
- Never log flag values that could contain secrets; log only the flag name and
  the resolved boolean.
- Each flag lists: purpose, default, owner, and rollback behavior.

## Flags

### `SUCCESSOR_MIGRATION_ENABLED`

- **Purpose:** Gate the successor migration tooling (issue #982). When off, the
  successor-migration entrypoints reject all writes with a stable error code
  (`SUCCESSOR_MIGRATION_DISABLED`) and do not touch `wallet.successor_id`.
- **Default:** `false` (off).
- **Owner:** Wallet / AA team.
- **Rollback:** Set to `false` and redeploy/restart. In-flight writes fail closed;
  no partial successor assignments are persisted because the write is a single
  transactional update guarded by the flag check.
- **Notes:** The underlying schema field and migration
  (`prisma/migrations/20260601000000_add_wallet_successor_id/`) are additive and
  safe to leave in place when the flag is off.

### `SUCCESSOR_MIGRATION_MAINNET_ENABLED`

- **Purpose:** Additional kill-switch for mainnet. Even when
  `SUCCESSOR_MIGRATION_ENABLED` is on, mainnet writes require this flag to be on.
- **Default:** `false` (off).
- **Owner:** Wallet / AA team.
- **Rollback:** Set to `false`. Mainnet successor writes fail closed with
  `SUCCESSOR_MIGRATION_MAINNET_DISABLED`; testnet behavior is unaffected.
- **Notes:** Prevents testnet-vs-mainnet misconfiguration from mutating mainnet
  wallet state.

## Kill-switch checklist

Before enabling any flag above on mainnet:

1. Confirm the readiness checklist in the PR is complete.
2. Confirm authz (owner/delegate/guardian/API-key/JWT) is enforced and covered by
   negative tests.
3. Confirm idempotency/replay protection is active for the write path.
4. Confirm fail-closed behavior on RPC/DB/Horizon outages.
5. Confirm metrics/logs are wired and do not leak secrets or raw key material.
