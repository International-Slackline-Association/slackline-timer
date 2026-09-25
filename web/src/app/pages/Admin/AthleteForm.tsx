import { ChangeEvent, useRef, useState } from 'react';

import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { useCreateAthlete, useUpdateAthlete, type AthleteInput } from 'app/api/athletes';
import { ACCEPTED_IMAGE_TYPES, acceptedFormatsHint, uploadAthletePhoto } from 'app/api/photoUpload';
import { CountryFlag } from 'app/components/CountryFlag';
import { useElementWidth } from 'app/hooks/useElementWidth';
import { EntityFormDialog, useEntityForm } from 'app/pages/Admin/entityForm';
import { GENDERS, fullName, type Athlete, type Gender } from 'app/types';
import { apiErrorMessage } from 'app/util/apiError';
import { genderLabel } from 'app/util/gender';
import { AthleteCard } from 'app/pages/Stream/AthleteCard';
import { AthleteNameStrip } from 'app/pages/Stream/AthleteNameStrip';
import { colors } from 'app/theme/tokens';

/** URL.createObjectURL guarded for jsdom (which doesn't implement it). */
const safeObjectUrl = (file: File): string | undefined => {
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
};

/** Local form shape: optional fields are always-present strings for controlled inputs. */
interface FormState {
  firstName: string;
  lastName: string;
  shortName: string;
  birthDate: string;
  country: string;
  country2: string;
  gender: Gender;
  notes: string;
  /** Preserved across edits so saving without a photo UI doesn't drop it. */
  photoKey?: string;
}

const toFormState = (athlete?: Athlete): FormState => ({
  firstName: athlete?.firstName ?? '',
  lastName: athlete?.lastName ?? '',
  shortName: athlete?.shortName ?? '',
  birthDate: athlete?.birthDate ?? '',
  country: athlete?.country ?? '',
  country2: athlete?.country2 ?? '',
  gender: athlete?.gender ?? 'male',
  notes: athlete?.notes ?? '',
  photoKey: athlete?.photoKey,
});

const toInput = (form: FormState): AthleteInput => ({
  firstName: form.firstName.trim(),
  lastName: form.lastName.trim(),
  name: fullName(form.firstName.trim(), form.lastName.trim()),
  birthDate: form.birthDate,
  country: form.country.trim(),
  gender: form.gender,
  ...(form.shortName.trim() ? { shortName: form.shortName.trim() } : {}),
  ...(form.country2.trim() ? { country2: form.country2.trim() } : {}),
  ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  ...(form.photoKey ? { photoKey: form.photoKey } : {}),
});

/**
 * A live `Athlete` for the broadcast-card preview, built from the in-progress
 * form state + the locally-previewed photo. Not persisted — it lets the operator
 * see the on-air `AthleteCard`/`AthleteNameStrip` (photo + name split + flag)
 * without a deployed overlay. `photoUrl` uses the local object URL so the
 * portrait shows before the upload round-trips a signed CloudFront URL.
 */
const toPreviewAthlete = (form: FormState, photoUrl?: string): Athlete => ({
  athleteId: 'preview',
  compId: 'preview',
  firstName: form.firstName.trim(),
  lastName: form.lastName.trim(),
  name: fullName(form.firstName.trim(), form.lastName.trim()),
  birthDate: form.birthDate,
  country: form.country.trim(),
  gender: form.gender,
  ...(form.shortName.trim() ? { shortName: form.shortName.trim() } : {}),
  ...(form.country2.trim() ? { country2: form.country2.trim() } : {}),
  ...(photoUrl ? { photoUrl } : {}),
});

/**
 * Create/edit dialog for an athlete. `athlete` undefined → create; otherwise
 * edit (the existing `photoKey` is carried through untouched). Closes on a
 * successful save.
 */
export const AthleteForm = ({
  compId,
  athlete,
  open,
  onClose,
}: {
  compId: string;
  athlete?: Athlete;
  open: boolean;
  onClose: () => void;
}) => {
  const { isEdit, form, setForm, updateField, submit, mutation } = useEntityForm({
    entity: athlete,
    initialForm: () => toFormState(athlete),
    create: useCreateAthlete(compId),
    update: useUpdateAthlete(compId),
    getId: (a) => a.athleteId,
    onClose,
  });

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(athlete?.photoUrl);

  const previewAthlete = toPreviewAthlete(form, previewUrl);

  const onPickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after an error
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const photoKey = await uploadAthletePhoto(compId, file);
      setForm((prev) => ({ ...prev, photoKey }));
      setPreviewUrl(safeObjectUrl(file));
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <EntityFormDialog
      open={open}
      onClose={onClose}
      entityName="athlete"
      isEdit={isEdit}
      onSubmit={() => submit(toInput(form))}
      mutation={mutation}
      busy={uploading}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Avatar
          src={previewUrl}
          alt={fullName(form.firstName, form.lastName)}
          sx={{ width: 64, height: 64 }}
        />
        <Box>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={onPickPhoto}
            style={{ display: 'none' }}
            data-testid="photo-input"
          />
          <Button
            variant="outlined"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            startIcon={uploading ? <CircularProgress size={16} /> : undefined}
          >
            {form.photoKey ? 'Replace photo' : 'Upload photo'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {acceptedFormatsHint()}
          </Typography>
        </Box>
      </Stack>
      {uploadError != null && <Alert severity="error">{apiErrorMessage(uploadError)}</Alert>}
      <CardPreview athlete={previewAthlete} />
      <Stack direction="row" spacing={2}>
        <TextField
          label="First name"
          value={form.firstName}
          onChange={updateField('firstName')}
          required
          autoFocus
          sx={{ flex: 1 }}
        />
        <TextField
          label="Last name"
          value={form.lastName}
          onChange={updateField('lastName')}
          required
          sx={{ flex: 1 }}
        />
      </Stack>
      <TextField
        label="Short name (optional)"
        helperText="Shown on overlays where space is tight; defaults to the last name."
        value={form.shortName}
        onChange={updateField('shortName')}
      />
      <TextField
        label="Birth date"
        type="date"
        value={form.birthDate}
        onChange={updateField('birthDate')}
        slotProps={{ inputLabel: { shrink: true } }}
        required
      />
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <TextField
          label="Country"
          helperText="ISO code, e.g. USA or DE."
          value={form.country}
          onChange={updateField('country')}
          required
          sx={{ flex: 1 }}
        />
        <CountryFlag code={form.country} height={24} />
      </Stack>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <TextField
          label="Second country (optional)"
          value={form.country2}
          onChange={updateField('country2')}
          sx={{ flex: 1 }}
        />
        <CountryFlag code={form.country2} height={24} />
      </Stack>
      <TextField
        label="Gender"
        select
        value={form.gender}
        onChange={updateField('gender')}
        required
      >
        {GENDERS.map((g) => (
          <MenuItem key={g} value={g}>
            {genderLabel(g, 'subject')}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Notes (optional)"
        value={form.notes}
        onChange={updateField('notes')}
        multiline
        minRows={2}
      />
    </EntityFormDialog>
  );
};

/** Broadcast panel geometry from `Competitor.tsx` (measurement record:
 *  `doc/dev/design-system/design-system.md` §7 "VS head-to-head"): the master's
 *  card box plus a constant 9px frame stroke on the 498.02-tall card. Driving
 *  `AthleteCard`'s container-query knobs (correct aspect + this proportional
 *  edge, not the ~0.4cqh default) reproduces the on-air card here, just smaller. */
const CARD_EDGE_WIDTH = `${((9 / 498.02) * 100).toFixed(3)}cqh`;

/** The name strip is authored at a fixed 720×92 (`AthleteNameStrip`); scaled to
 *  the available width so it stays crisp and never right-edge clips. */
const STRIP_W = 720;
const STRIP_H = 92;
/** Scale when the width can't be measured (jsdom has no ResizeObserver) — fills
 *  the `maxWidth="sm"` dialog. */
const STRIP_FALLBACK_SCALE = 0.75;

/**
 * Read-only broadcast-card preview for the in-progress athlete — the on-air
 * `AthleteCard` and `AthleteNameStrip` so an operator validates the broadcast
 * look (photo, name weights, flag) at authoring time without a live overlay.
 * Backed by the slate `surface.void` the overlays composite over, so the white
 * plates read as they will on air.
 *
 * The two treatments are stacked VERTICALLY, each at true broadcast proportions:
 * the tall 0.60 LAAX portrait card and the ~7.8:1 name strip are two distinct
 * lower-thirds (never on air together), so a single side-by-side scale can't
 * render both honestly.
 */
const CardPreview = ({ athlete }: { athlete: Athlete }) => {
  const [stripRef, stripWidth] = useElementWidth<HTMLDivElement>();
  const stripScale = stripWidth > 0 ? stripWidth / STRIP_W : STRIP_FALLBACK_SCALE;
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        Broadcast preview
      </Typography>
      <Stack
        spacing={2}
        sx={{
          alignItems: 'center',
          p: 2,
          borderRadius: 1,
          backgroundColor: colors.surface.void,
          overflow: 'hidden',
        }}
      >
        {/* Card at the LAAX panel aspect (Competitor's 298.81×498.02 box) with a
            fixed crisp height; container-query units scale the rest. */}
        <Box sx={{ height: 240, aspectRatio: '298.81 / 498.02', flexShrink: 0 }}>
          <AthleteCard athlete={athlete} edgeWidth={CARD_EDGE_WIDTH} />
        </Box>
        {/* Name strip at its native 720×92, scaled to the measured panel width
            (transformOrigin top-left, reserving the scaled height). */}
        {athlete.country && (
          <Box
            ref={stripRef}
            sx={{ width: '100%', overflow: 'hidden', height: STRIP_H * stripScale }}
          >
            <Box
              sx={{
                width: STRIP_W,
                transform: `scale(${stripScale})`,
                transformOrigin: 'top left',
              }}
            >
              <AthleteNameStrip athlete={athlete} />
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
};
