import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOffline, resetOfflineWarningForTest } from 'core/offline';

import { OFFLINE_ENV } from '../../scripts/offlineEnv.mjs';

describe('isOffline', () => {
  const saved = {
    IS_OFFLINE: process.env.IS_OFFLINE,
    AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
  };
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.IS_OFFLINE;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    resetOfflineWarningForTest();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('is false without IS_OFFLINE', () => {
    expect(isOffline()).toBe(false);
    process.env.IS_OFFLINE = 'false';
    expect(isOffline()).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('is true for IS_OFFLINE=true outside Lambda (harness / tests)', () => {
    process.env.IS_OFFLINE = 'true';
    expect(isOffline()).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refuses IS_OFFLINE inside Lambda and logs once per container', () => {
    process.env.IS_OFFLINE = 'true';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'slackline-timer-v1-httpAuthorizer-prod';
    expect(isOffline()).toBe(false);
    expect(isOffline()).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('slackline-timer-v1-httpAuthorizer-prod');
  });

  it('stays silent inside Lambda when IS_OFFLINE is unset', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'slackline-timer-v1-authorizer-prod';
    expect(isOffline()).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // The harnesses run the real handlers in-process from OFFLINE_ENV; carrying
  // the Lambda marker would silently switch every offline branch off.
  it('the offline harness env never sets the Lambda marker', () => {
    expect(OFFLINE_ENV).not.toHaveProperty('AWS_LAMBDA_FUNCTION_NAME');
    expect(saved.AWS_LAMBDA_FUNCTION_NAME).toBeUndefined();
  });
});
