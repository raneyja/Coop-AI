# Unexpected thread reset: source investigation

Parent observed an empty New Chat after remote source explanation run `b5d3afa1-ff85-4b9f-a650-6c7d43b52200` on bundle `7179750e87659b1ad12089fbf737d5688e140bb25d447e6b586b4cf6177ce06e`. Diagnostics confirm remote read `src/mathRenamed.ts`, answer start 13089 ms, successful server outcome 17352 ms. Parent reports no intervening New Chat action and no extension-host restart. The cause of this particular UI reset is unconfirmed.

Read-only source investigation identified a concrete hazardous chain:

1. `verifyStoredSession` returns undefined on a non-auth network failure and retains stored tokens; its existing regression explicitly asserts this behavior.
2. `readPreferences` converts undefined verification to signed-out preferences.
3. `CoopChatSession.refreshPreferences` compares the prior signed-in identity to the new empty identity.
4. `syncSurfacesAfterAuthChange` persists the current thread, rebinds storage to signed-out scope, and activates that scope's empty thread. Prior account threads disappear from the visible list, though they remain in their original scope.

This chain can explain an empty chat/list without an extension restart, but current logs contain no identity transition or verification availability evidence to associate it with the observed run. Shared startup initialization is already present and prevents duplicate initial hydration. Separate asynchronous startup and settings/config preference refreshes can overlap; default codehost persistence inside preference reading can itself initiate a configuration refresh.

Recommended next verification: add nonsecret diagnostics for preference identity transitions and whether stored token verification was unavailable; reproduce an unavailable `/v1/me` during refresh through a harness. Preserve the existing thread binding on transient unavailable verification while retaining clear isolation on confirmed sign-out/account changes. Do not replace unavailable verification with invented authenticated permissions.

After parent authorization and review, a narrow source repair was prepared: refresh compares the retained account thread binding, and leaves it intact on unavailable verification only when the current token exactly matches the last privately verified session token. That token association is held only in memory, never persisted or logged. Credentials are captured before and after verification and immediately before binding, so a changed credential cannot associate a stale verification with a different session. Signed-out preferences stay signed out; this does not grant cached permissions. Recovery to the same verified account does not unnecessarily reactivate/clear its thread. Confirmed sign-out/token clearing, changed unverified credentials, and verified different accounts still isolate storage. Added auth identity regressions cover those transitions; parent owns execution. The cause of the observed live reset remains unconfirmed. Overlapping refresh/account change qualification remains open.
