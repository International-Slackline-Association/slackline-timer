import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SecondsField } from 'app/components/SecondsField';

import { px } from '../../util/computedUnits';

const field = () => screen.getByLabelText('Run (s)') as HTMLInputElement;

describe('SecondsField', () => {
  it('shows the seconds it is handed on a numeric input', () => {
    render(<SecondsField label="Run (s)" value={75} onChange={vi.fn()} />);

    expect(field().value).toBe('75');
    expect(field().type).toBe('number');
    expect(field().inputMode).toBe('numeric');
  });

  it("hands back the typed seconds — the unit conversion stays the caller's", () => {
    const onChange = vi.fn();
    render(<SecondsField label="Run (s)" value={75} onChange={onChange} />);

    fireEvent.change(field(), { target: { value: '90' } });

    expect(onChange).toHaveBeenCalledWith(90);
  });

  it('drops the focus on a wheel, so a stray scroll cannot retune a live budget', () => {
    render(<SecondsField label="Run (s)" value={75} onChange={vi.fn()} />);
    field().focus();
    expect(document.activeElement).toBe(field());

    fireEvent.wheel(field());

    expect(document.activeElement).not.toBe(field());
  });

  it('keeps the §6 44 px target — MUI sizes a `small` field at 40', () => {
    render(<SecondsField label="Run (s)" value={75} onChange={vi.fn()} />);

    expect(
      px(getComputedStyle(field().parentElement as HTMLElement).minHeight),
    ).toBeGreaterThanOrEqual(44);
  });

  it('locks and says why when the clock it tunes is running', () => {
    render(
      <SecondsField
        label="Run (s)"
        value={75}
        onChange={vi.fn()}
        disabled
        helperText="locked while Athlete 1 runs"
      />,
    );

    expect(field()).toBeDisabled();
    expect(screen.getByText('locked while Athlete 1 runs')).toBeVisible();
  });
});
