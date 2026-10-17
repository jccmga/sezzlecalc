import { describe, expect, it } from 'vitest';
import { formatNumber, MAX_SIGNIFICANT_DIGITS } from './format';

const cases: Array<[number, string]> = [
  [48, '48'], [0, '0'], [-0, '0'], [0.5, '0.5'], [-2.5, '-2.5'],
  [100, '100'], [1 / 3, '0.333333333333'], [Math.PI, '3.14159265359'],
  [1e12, '1e+12'], [123456789012, '123456789012'], [1e21, '1e+21'],
  [1e-7, '1e-7'], [1.5e-9, '1.5e-9'], [1e-6, '0.000001'],
  [Infinity, 'Error'], [NaN, 'Error'],
];

describe('formatNumber', () => {
  it.each(cases)('formats %p as %s', (input, expected) => {
    expect(formatNumber(input)).toBe(expected);
  });

  it('MAX_SIGNIFICANT_DIGITS is 12', () => {
    expect(MAX_SIGNIFICANT_DIGITS).toBe(12);
  });
});
