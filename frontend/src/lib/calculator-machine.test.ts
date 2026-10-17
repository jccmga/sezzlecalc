import { describe, expect, it } from 'vitest';

import { reducer, type CalculatorState } from './calculator-machine';

describe('reducer', () => {
  it('C2: clears entry, lhs, and operator on any failed resolution', () => {
    const before: CalculatorState = {
      entry: '48',
      lhs: 12,
      operator: 'add',
      status: 'busy',
      error: null,
    };

    const after = reducer(before, {
      type: 'resolve',
      outcome: { ok: false, error: 'division by zero' },
      preserve: true,
    });

    expect(after).toEqual({
      entry: '',
      lhs: null,
      operator: null,
      status: 'error',
      error: 'division by zero',
    });
  });

  it('C4 (reducer): a digit after error clears the error and returns to editing', () => {
    const before: CalculatorState = {
      entry: '',
      lhs: null,
      operator: null,
      status: 'error',
      error: 'division by zero',
    };

    const after = reducer(before, { type: 'digit', d: '2' });

    expect(after).toEqual({
      entry: '2',
      lhs: null,
      operator: null,
      status: 'editing',
      error: null,
    });
  });
});
