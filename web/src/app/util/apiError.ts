import { ApiError } from 'app/api/client';

/** Flatten an error (with optional ApiError validation details) into one line. */
export const apiErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.details?.length ? `${error.message}: ${error.details.join(', ')}` : error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
};
