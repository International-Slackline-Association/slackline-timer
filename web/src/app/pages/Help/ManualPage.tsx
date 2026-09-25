import { useEffect } from 'react';

import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';

import { Markdown } from 'app/components/Markdown';
import { manualArticle, manualArticles, manualHref } from 'app/manual/manual';

import { ManualGate } from './ManualGate';

/**
 * `/help` + `/help/:slug` — the published user manual (`doc/user/*.md`).
 *
 * Two routes, one gate: the index lists every article, the article route renders
 * one. Both go through `ManualGate` so the manual only appears for a signed-in
 * operator who can actually view a competition.
 */

/** Left-hand contents, shared by both routes so navigation never dead-ends. */
const ManualNav = ({ activeSlug }: { activeSlug?: string }) => (
  <Stack spacing={0.5} sx={{ minWidth: 220 }}>
    <Typography variant="overline" color="text.secondary">
      Manual
    </Typography>
    {manualArticles.map((article) => (
      <Box
        key={article.slug}
        component={RouterLink}
        to={`/help/${article.slug}`}
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: 1,
          textDecoration: 'none',
          color: article.slug === activeSlug ? 'primary.main' : 'text.primary',
          backgroundColor: article.slug === activeSlug ? 'action.selected' : 'transparent',
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: article.slug === activeSlug ? 700 : 400 }}>
          {article.title}
        </Typography>
      </Box>
    ))}
  </Stack>
);

export const ManualIndexPage = () => (
  <ManualGate>
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Manual
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        How to run an event with Slackline Timer — one guide per job.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
        }}
      >
        {manualArticles.map((article) => (
          <Card key={article.slug} variant="outlined">
            <CardActionArea
              component={RouterLink}
              to={`/help/${article.slug}`}
              sx={{ height: '100%' }}
            >
              <CardContent>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="h6">{article.title}</Typography>
                  {article.audience && (
                    <Chip size="small" variant="outlined" label={article.audience} />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {article.summary}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Container>
  </ManualGate>
);

export const ManualArticlePage = () => {
  const { slug } = useParams();
  const { hash } = useLocation();
  const article = manualArticle(slug);

  // Cross-article anchors (`./troubleshooting.md#the-buzzers-do-nothing`) arrive
  // as a client-side navigation, which the browser does not scroll for.
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, slug]);

  return (
    <ManualGate>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
          <ManualNav activeSlug={slug} />
          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
          <Box sx={{ flex: 1, minWidth: 0, maxWidth: 820 }}>
            {article ? (
              <Markdown resolveHref={manualHref}>{article.body}</Markdown>
            ) : (
              <Alert severity="warning">
                No manual page called “{slug}”. Pick one from the list.
              </Alert>
            )}
          </Box>
        </Stack>
      </Container>
    </ManualGate>
  );
};
