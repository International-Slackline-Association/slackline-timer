import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectField, enumOptions } from 'app/components/SelectField';

describe('enumOptions', () => {
  it('maps enum members through the labeller', () => {
    expect(enumOptions(['a', 'b'] as const, (v) => v.toUpperCase())).toEqual([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]);
  });
});

describe('SelectField', () => {
  const options = [
    { value: 'x', label: 'Ex' },
    { value: 'y', label: 'Why' },
  ];

  it('renders a native select with an option per entry', () => {
    render(<SelectField label="Pick" value="x" onChange={() => {}} options={options} />);
    const select = screen.getByLabelText('Pick') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.value)).toEqual(['x', 'y']);
    expect(select.value).toBe('x');
  });

  it('renders the placeholder as the leading option', () => {
    render(
      <SelectField
        label="Pick"
        value=""
        onChange={() => {}}
        placeholder={{ value: '', label: 'Select…', disabled: true }}
        options={options}
      />,
    );
    const first = (screen.getByLabelText('Pick') as HTMLSelectElement).options[0];
    expect(first.textContent).toBe('Select…');
    expect(first.disabled).toBe(true);
  });

  it('forwards change events', () => {
    const onChange = vi.fn();
    render(<SelectField label="Pick" value="x" onChange={onChange} options={options} />);
    fireEvent.change(screen.getByLabelText('Pick'), { target: { value: 'y' } });
    expect(onChange).toHaveBeenCalledOnce();
  });
});
