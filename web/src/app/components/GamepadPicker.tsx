import { Typography } from '@mui/material';

import { SelectField } from 'app/components/SelectField';
import { useGamepadSelection } from 'app/state/gamepadSelection';
import { liveCaption } from 'app/theme/tokens';

/**
 * Operator control for choosing which connected game controller drives the
 * timer. Mounted once per control page — inside the handset card, which is what
 * both desks read for pad presence — so it reads the shared selection and the
 * one chosen pad drives both Freestyle players. Only renders a picker with >1
 * pad; a single pad shows a caption instead (no picker burden), and the
 * NO-pad state is the card's to word: it is the state the operator is looking
 * at the card to resolve, so it belongs in the card's own voice
 * ("press any button to reveal it"), not in a second line under it.
 *
 * It picks through the house **native** `SelectField` and drops focus on the
 * change: Space is the buzzer on the desk this sits in (FREESTYLE_BOARD_UX
 * §4.3), so a MUI popup would make the whole board inert as a `[role=listbox]`
 * overlay, and the combobox it hands focus back to would own every press after.
 */
export const GamepadPicker = () => {
  const { connectedPads, selectedPadId, setSelectedPadId, selectedIndex } = useGamepadSelection();

  if (connectedPads.length === 0) return null;

  if (connectedPads.length === 1) {
    return (
      <Typography variant="caption" sx={liveCaption} color="text.secondary">
        Controller: {connectedPads[0].id}
      </Typography>
    );
  }

  // Fall back to the auto-resolved pad's id so the control names the pad that is
  // actually driving the timer when nothing has been explicitly chosen.
  const value = selectedPadId ?? connectedPads.find((p) => p.index === selectedIndex)?.id ?? '';

  return (
    <SelectField
      label="Controller"
      size="small"
      sx={{ minWidth: 220 }}
      value={value}
      onChange={(event) => {
        setSelectedPadId(event.target.value || null);
        event.target.blur();
      }}
      options={connectedPads.map((pad) => ({ value: pad.id, label: pad.id }))}
    />
  );
};
