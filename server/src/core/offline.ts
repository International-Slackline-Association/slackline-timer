/**
 * The one gate for every offline branch (LocalStack clients, the `local-dev`
 * operator bypass in both authorizers, the harness WS endpoint, fake Cognito
 * subs, unsigned photo URLs). `IS_OFFLINE` alone would turn a deployed function
 * into an open admin endpoint if the variable ever reached its env, so the
 * branch also requires being outside Lambda: the runtime always sets
 * `AWS_LAMBDA_FUNCTION_NAME`, the harnesses and the test runner never do.
 */

let warned = false;

export const isOffline = (): boolean => {
  if (process.env.IS_OFFLINE !== 'true') return false;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    if (!warned) {
      warned = true;
      console.error(
        `SECURITY: IS_OFFLINE=true inside Lambda ${process.env.AWS_LAMBDA_FUNCTION_NAME}; offline branches stay disabled. Remove it from the function env.`,
      );
    }
    return false;
  }
  return true;
};

/** Test seam: re-arm the once-per-container warning. */
export const resetOfflineWarningForTest = (): void => {
  warned = false;
};
