import type { EvaluateOutcome } from './api';
import { formatNumber } from './format';
import { parseEntry, type BinaryOperation } from './validation';

export type DisplayStatus = 'editing' | 'awaiting' | 'result' | 'error' | 'busy';

export interface CalculatorState {
  entry: string;
  lhs: number | null;
  operator: BinaryOperation | null;
  status: DisplayStatus;
  error: string | null;
}

export const INITIAL: CalculatorState = {
  entry: '0',
  lhs: null,
  operator: null,
  status: 'editing',
  error: null,
};

export type Action =
  | { type: 'digit'; d: string }
  | { type: 'decimal' }
  | { type: 'sign' }
  | { type: 'clear' }
  | { type: 'backspace' }
  | { type: 'operator'; op: BinaryOperation }
  | { type: 'begin' }
  | { type: 'resolve'; outcome: EvaluateOutcome; preserve: boolean };

// ESLint cannot prove the nested switches over DisplayStatus are exhaustive,
// so it reports a false fallthrough to the next case.
/* eslint-disable no-fallthrough */
export function reducer(state: CalculatorState, action: Action): CalculatorState {
  switch (action.type) {
    case 'digit': {
      const d = action.d;
      switch (state.status) {
        case 'busy':
          return state;
        case 'result':
        case 'error':
          // lhs and operator survive a unary, so they are preserved here.
          return { ...state, entry: d, status: 'editing', error: null };
        case 'awaiting':
          return { ...state, entry: d, status: 'editing' };
        case 'editing':
          if (state.entry === '0' || state.entry === '') return { ...state, entry: d };
          return { ...state, entry: state.entry + d };
      }
    }
    case 'decimal': {
      switch (state.status) {
        case 'busy':
          return state;
        case 'result':
        case 'error':
          return { ...state, entry: '0.', status: 'editing', error: null };
        case 'awaiting':
          return { ...state, entry: '0.', status: 'editing' };
        case 'editing':
          if (state.entry === '') return { ...state, entry: '0.' };
          if (state.entry.includes('.')) return state;
          return { ...state, entry: state.entry + '.' };
      }
    }
    case 'sign': {
      if (state.status === 'busy' || state.status === 'error' || state.status === 'awaiting') {
        return state;
      }
      if (state.entry === '') return state;
      const v = parseEntry(state.entry);
      if (v === null || v === 0) return state;
      return {
        ...state,
        entry: state.entry.startsWith('-') ? state.entry.slice(1) : '-' + state.entry,
      };
    }
    case 'clear':
      return { ...INITIAL };
    case 'backspace': {
      if (state.status !== 'editing') return state;
      const next = state.entry.slice(0, -1);
      const entry = next === '' || next === '-' ? '' : next;
      return { ...state, entry };
    }
    case 'operator': {
      if (state.status === 'busy' || state.status === 'error') return state;
      const v = parseEntry(state.entry);
      if (v === null) return state;
      if (state.status === 'editing' && state.operator !== null) {
        // A typed second operand only replaces the operator; it never evaluates.
        return { ...state, operator: action.op, status: 'awaiting' };
      }
      return { ...state, lhs: v, operator: action.op, status: 'awaiting' };
    }
    case 'begin':
      return { ...state, status: 'busy' };
    case 'resolve': {
      if (action.outcome.ok) {
        return {
          entry: formatNumber(action.outcome.value),
          lhs: action.preserve ? state.lhs : null,
          operator: action.preserve ? state.operator : null,
          status: 'result',
          error: null,
        };
      }
      return { entry: '', lhs: null, operator: null, status: 'error', error: action.outcome.error };
    }
  }
}
/* eslint-enable no-fallthrough */
