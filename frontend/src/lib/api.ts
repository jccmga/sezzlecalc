import type { BinaryOperation, UnaryOperation } from './validation';

export type EvaluateRequest =
  | { operation: BinaryOperation; a: number; b: number }
  | { operation: UnaryOperation; a: number };

export type EvaluateOutcome =
  | { ok: true; value: number }
  | { ok: false; error: string };

// An empty VITE_API_BASE_URL resolves to '/evaluate' rather than '/api/evaluate'.
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(
  /\/+$/,
  '',
);

export const EVALUATE_URL: string = `${API_BASE_URL}/evaluate`;

export const REQUEST_TIMEOUT_MS = 10_000;

export const TRANSPORT_ERROR = 'Could not reach the server';

export async function evaluate(request: EvaluateRequest): Promise<EvaluateOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(EVALUATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: TRANSPORT_ERROR };
    }

    if (response.ok) {
      const result = (body as { result?: unknown }).result;
      if (typeof result === 'number' && Number.isFinite(result)) {
        return { ok: true, value: result };
      }
      return { ok: false, error: TRANSPORT_ERROR };
    }

    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string' && error.length > 0) {
      return { ok: false, error };
    }
    return { ok: false, error: TRANSPORT_ERROR };
  } catch {
    return { ok: false, error: TRANSPORT_ERROR };
  } finally {
    clearTimeout(timer);
  }
}
