/**
 * Shape guard for the WS `$connect` operator session, run before the META
 * lookup the authorizer does itself. `"default"` (the web's fallback), missing
 * and empty ids are never competitions. Kept out of the handler module, which
 * builds a `CognitoJwtVerifier` at load and needs `COGNITO_*` env.
 */
export const isValidOperatorSessionId = (sessionId: string | undefined): boolean =>
  sessionId !== undefined && sessionId !== '' && sessionId !== 'default';
