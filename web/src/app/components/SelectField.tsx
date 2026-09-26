import { TextField, type TextFieldProps } from '@mui/material';

/** One entry in a native `<select>`; `value` is also the React key. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectFieldProps = Omit<TextFieldProps, 'select' | 'children' | 'placeholder'> & {
  options: SelectOption[];
  /** Leading entry — a disabled prompt ("Select…") or an "All"/"— TBD —" reset. */
  placeholder?: SelectOption;
};

/**
 * The house native-select field: a MUI `TextField select` carrying the shared
 * `native` + shrunk-label slotProps and rendering `<option>`s from data, so the
 * incantation lives in one place instead of at ~30 call sites. Pair with
 * `enumOptions` for enum-backed pickers.
 */
export const SelectField = ({ options, placeholder, slotProps, ...rest }: SelectFieldProps) => (
  <TextField
    select
    slotProps={{ select: { native: true }, inputLabel: { shrink: true }, ...slotProps }}
    {...rest}
  >
    {placeholder && (
      <option value={placeholder.value} disabled={placeholder.disabled}>
        {placeholder.label}
      </option>
    )}
    {options.map((option) => (
      <option key={option.value} value={option.value} disabled={option.disabled}>
        {option.label}
      </option>
    ))}
  </TextField>
);

/** Map an enum's members to `SelectOption`s through a display labeller. */
export const enumOptions = <T extends string>(
  values: readonly T[],
  label: (value: T) => string,
): SelectOption[] => values.map((value) => ({ value, label: label(value) }));
