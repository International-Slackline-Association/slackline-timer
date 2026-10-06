/**
 * Signed photo URLs expire 12–18 h after they are minted (server
 * core/eventWindow.ts `computePhotoUrlExpiry`). An OBS overlay or an admin tab
 * can sit idle longer than that, so every photo-carrying query re-fetches well
 * inside the 12 h floor, also while the page is hidden — one GET per 3 h.
 */
export const PHOTO_URL_REFETCH_MS = 3 * 60 * 60 * 1000;

export const PHOTO_URL_REFETCH = {
  refetchInterval: PHOTO_URL_REFETCH_MS,
  refetchIntervalInBackground: true,
} as const;
