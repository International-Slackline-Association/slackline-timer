/**
 * Operator-session validity guard for the WS `$connect` authorizer.
 *
 * Lives here (side-effect-free `core/`) rather than inside the authorizer
 * handler so it can be unit-tested without importing the handler module, which
 * constructs a `CognitoJwtVerifier` at load time and needs `COGNITO_*` env.
 *
 * An operator may only join a session that is a real competition. The literal
 * `"default"` (the web's upstream fallback), missing, and empty session ids are
 * never real competitions, so they are rejected up front before the DB lookup.
 * Whether the session actually has a META row is checked separately by the
 * handler via `competitionDb.getCompetition`.
 */
export const isValidOperatorSessionId = (sessionId: string | undefined): boolean =>
  sessionId !== undefined && sessionId !== '' && sessionId !== 'default';
