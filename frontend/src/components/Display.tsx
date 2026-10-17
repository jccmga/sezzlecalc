import type { DisplayStatus } from '@/lib/calculator-machine';
import { cn } from '@/lib/utils';

interface DisplayProps {
  entry: string;
  status: DisplayStatus;
  error: string | null;
}

export default function Display({ entry, status, error }: DisplayProps) {
  const isError = status === 'error';
  const text = isError ? (error ?? 'Unknown error') : entry === '' ? '0' : entry;
  const size = isError ? 'text-lg break-words' : text.length <= 10 ? 'text-4xl' : 'text-2xl';

  return (
    <output
      role={isError ? 'alert' : undefined}
      aria-live={isError ? undefined : 'polite'}
      aria-label="Calculator display"
      data-testid="calculator-display"
      className={cn(
        'flex min-h-[96px] w-full items-end justify-end text-right tabular-nums',
        isError ? 'whitespace-normal' : 'whitespace-nowrap',
        size,
      )}
    >
      {text}
    </output>
  );
}
