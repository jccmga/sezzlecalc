import { useCallback, useEffect, useReducer, useRef } from 'react';

import Display from '@/components/Display';
import { Button } from '@/components/ui/button';
import { evaluate, type EvaluateRequest } from '@/lib/api';
import { INITIAL, reducer, type CalculatorState } from '@/lib/calculator-machine';
import { cn } from '@/lib/utils';
import { parseEntry, type UnaryOperation } from '@/lib/validation';

interface KeyDef {
  label: string;
  ariaLabel?: string;
  variant: 'digit' | 'operator' | 'equals' | 'clear';
  colSpan2?: boolean;
  onPress: () => void;
}

export default function Calculator() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const requestToken = useRef(0);

  const stateRef = useRef(state);
  stateRef.current = state;

  const evaluateCurrent = useCallback(
    (build: (s: CalculatorState) => EvaluateRequest | null, preserve: boolean) => {
      const s = stateRef.current;
      if (s.status === 'busy' || s.status === 'error') return;
      const request = build(s);
      if (request === null) return;
      const token = ++requestToken.current;
      dispatch({ type: 'begin' });
      void evaluate(request).then((outcome) => {
        if (token !== requestToken.current) return;
        dispatch({ type: 'resolve', outcome, preserve });
      });
    },
    [],
  );

  const pressEquals = useCallback(() => {
    evaluateCurrent((s) => {
      if (s.operator === null || s.lhs === null) return null;
      const b = parseEntry(s.entry);
      if (b === null) return null;
      return { operation: s.operator, a: s.lhs, b };
    }, false);
  }, [evaluateCurrent]);

  const pressUnary = useCallback(
    (op: UnaryOperation) => {
      evaluateCurrent((s) => {
        const v = parseEntry(s.entry);
        if (v === null) return null;
        return { operation: op, a: v };
      }, true);
    },
    [evaluateCurrent],
  );

  const clear = useCallback(() => {
    requestToken.current += 1;
    dispatch({ type: 'clear' });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) {
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        dispatch({ type: 'digit', d: e.key });
        return;
      }
      switch (e.key) {
        case '.':
          dispatch({ type: 'decimal' });
          return;
        case '+':
          dispatch({ type: 'operator', op: 'add' });
          return;
        case '-':
          dispatch({ type: 'operator', op: 'subtract' });
          return;
        case '*':
          dispatch({ type: 'operator', op: 'multiply' });
          return;
        case '/':
          dispatch({ type: 'operator', op: 'divide' });
          e.preventDefault();
          return;
        case 'Enter':
        case '=':
          pressEquals();
          return;
        case 'Backspace':
          dispatch({ type: 'backspace' });
          e.preventDefault();
          return;
        case 'Escape':
          clear();
          return;
        default:
          return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      requestToken.current += 1;
    };
  }, [clear, pressEquals]);

  const isBusy = state.status === 'busy';

  const keys: KeyDef[] = [
    { label: '√', ariaLabel: 'square root', variant: 'operator', colSpan2: true, onPress: () => pressUnary('sqrt') },
    { label: 'xʸ', ariaLabel: 'power', variant: 'operator', colSpan2: true, onPress: () => dispatch({ type: 'operator', op: 'power' }) },
    { label: 'AC', ariaLabel: 'clear', variant: 'clear', onPress: clear },
    { label: '±', ariaLabel: 'change sign', variant: 'digit', onPress: () => dispatch({ type: 'sign' }) },
    { label: '%', ariaLabel: 'percent', variant: 'operator', onPress: () => pressUnary('percent') },
    { label: '÷', ariaLabel: 'divide', variant: 'operator', onPress: () => dispatch({ type: 'operator', op: 'divide' }) },
    { label: '7', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '7' }) },
    { label: '8', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '8' }) },
    { label: '9', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '9' }) },
    { label: '×', ariaLabel: 'multiply', variant: 'operator', onPress: () => dispatch({ type: 'operator', op: 'multiply' }) },
    { label: '4', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '4' }) },
    { label: '5', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '5' }) },
    { label: '6', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '6' }) },
    { label: '−', ariaLabel: 'subtract', variant: 'operator', onPress: () => dispatch({ type: 'operator', op: 'subtract' }) },
    { label: '1', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '1' }) },
    { label: '2', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '2' }) },
    { label: '3', variant: 'digit', onPress: () => dispatch({ type: 'digit', d: '3' }) },
    { label: '+', ariaLabel: 'add', variant: 'operator', onPress: () => dispatch({ type: 'operator', op: 'add' }) },
    { label: '0', variant: 'digit', colSpan2: true, onPress: () => dispatch({ type: 'digit', d: '0' }) },
    { label: '.', ariaLabel: 'decimal point', variant: 'digit', onPress: () => dispatch({ type: 'decimal' }) },
    { label: '=', ariaLabel: 'equals', variant: 'equals', onPress: pressEquals },
  ];

  return (
    <section
      aria-label="Calculator"
      aria-busy={isBusy}
      className="w-full max-w-[360px] rounded-3xl border bg-card p-4 text-card-foreground shadow-lg sm:p-5"
    >
      <Display entry={state.entry} status={state.status} error={state.error} />

      <div role="group" aria-label="Keypad" className="grid grid-cols-4 gap-2 sm:gap-3">
        {keys.map((k) => (
          <Button
            key={k.ariaLabel ?? k.label}
            type="button"
            variant={k.variant}
            aria-label={k.ariaLabel}
            disabled={isBusy && k.label !== 'AC'}
            onClick={k.onPress}
            className={cn(k.colSpan2 ? 'col-span-2 w-full h-auto' : 'aspect-square w-full h-auto')}
          >
            {k.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
