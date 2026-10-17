import { describe, expect, it } from 'vitest';
import {
  BINARY_OPERATIONS, UNARY_OPERATIONS,
  isBinaryOperation, isUnaryOperation, parseEntry,
} from './validation';

describe('parseEntry', () => {
  it.each(['12', '-5', '3.', '0.', '.5', '1e+21', '1.5e-9', '-0'])('accepts %s', (s) => {
    expect(parseEntry(s)).not.toBeNull();
  });

  it.each(['', ' ', '-', '.', '-.', 'abc', '0x10', '1,000', 'Infinity', 'NaN', '1e999', ' 12 34'])('rejects %s', (s) => {
    expect(parseEntry(s)).toBeNull();
  });

  it('parses representative values', () => {
    expect(parseEntry('12')).toBe(12);
    expect(parseEntry('-5')).toBe(-5);
    expect(parseEntry('.5')).toBe(0.5);
    expect(parseEntry('3.')).toBe(3);
  });
});

describe('operation metadata', () => {
  it('BINARY_OPERATIONS are exactly the five', () => {
    expect(BINARY_OPERATIONS).toEqual(['add', 'subtract', 'multiply', 'divide', 'power']);
  });

  it('UNARY_OPERATIONS are exactly the two', () => {
    expect(UNARY_OPERATIONS).toEqual(['sqrt', 'percent']);
  });

  it('isBinaryOperation true for the five, false for unary', () => {
    for (const op of BINARY_OPERATIONS) expect(isBinaryOperation(op)).toBe(true);
    for (const op of UNARY_OPERATIONS) expect(isBinaryOperation(op)).toBe(false);
  });

  it('isUnaryOperation true for the two, false for binary', () => {
    for (const op of UNARY_OPERATIONS) expect(isUnaryOperation(op)).toBe(true);
    for (const op of BINARY_OPERATIONS) expect(isUnaryOperation(op)).toBe(false);
  });
});
