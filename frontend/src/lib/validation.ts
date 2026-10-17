export type BinaryOperation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power';
export type UnaryOperation = 'sqrt' | 'percent';
export type Operation = BinaryOperation | UnaryOperation;

export const BINARY_OPERATIONS: readonly BinaryOperation[] = [
  'add',
  'subtract',
  'multiply',
  'divide',
  'power',
];

export const UNARY_OPERATIONS: readonly UnaryOperation[] = ['sqrt', 'percent'];

export const ENTRY_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function isBinaryOperation(op: Operation): op is BinaryOperation {
  return (BINARY_OPERATIONS as readonly string[]).includes(op);
}

export function isUnaryOperation(op: Operation): op is UnaryOperation {
  return (UNARY_OPERATIONS as readonly string[]).includes(op);
}

export function parseEntry(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  if (!ENTRY_PATTERN.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
