import type { ReactNode } from 'react';

import { Alert, CircularProgress, Typography } from '@mui/material';

import { apiErrorMessage } from 'app/util/apiError';

/** The subset of a React Query list result the state triad needs (structural,
 *  so any `UseQueryResult<T[]>` fits without coupling to a concrete type). */
type ListQueryLike = {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: readonly unknown[] | undefined;
};

/**
 * The loading / error / empty triad every admin list page repeats over its
 * primary query. `alsoLoading` folds in secondary queries (e.g. the athlete
 * join) that should show the spinner but contribute no error/empty state of
 * their own. Renders nothing once the primary query has non-empty data.
 */
export const QueryStates = ({
  query,
  alsoLoading = false,
  empty,
}: {
  query: ListQueryLike;
  alsoLoading?: boolean;
  empty: ReactNode;
}) => (
  <>
    {(query.isLoading || alsoLoading) && <CircularProgress />}
    {query.isError && <Alert severity="error">{apiErrorMessage(query.error)}</Alert>}
    {query.data?.length === 0 && <Typography color="text.secondary">{empty}</Typography>}
  </>
);
