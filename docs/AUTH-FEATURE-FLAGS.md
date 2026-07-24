# Auth Feature Flags

This document summarizes feature flags added for the auth and session endpoints.

- `FEATURE_AUTH_API` (boolean, default: false)
  - When `true`, the auth endpoints (`POST /auth/authenticate`, `GET /auth/sessions`, `GET /auth/validate/:authId`) are enabled.
  - When `false` or unset, the endpoints return HTTP 403 (Forbidden) with message: "Feature is not available at this time. (Flag: auth_api)".

Notes:
- The flag is implemented via the existing `FeatureFlagGuard` and the `@FeatureFlag('auth_api')` decorator on the `AuthOrchestratorController`.
- The guard reads environment variables using the existing pattern: `FEATURE_<FLAG_NAME>=true|false` (e.g. `FEATURE_AUTH_API=true`).
- Existing unit tests for `FeatureFlagGuard` cover enabled/disabled behavior. The auth controller tests were adjusted to override the guard for isolation.

Operational guidance:
- To enable auth in runtime, set `FEATURE_AUTH_API=true` in the configuration used by the service (env, k8s secret, etc.).
- Ensure any API gateway or routing changes are coordinated when toggling this flag in production to avoid unexpected client errors.
