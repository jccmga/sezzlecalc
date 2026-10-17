import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluate, EVALUATE_URL, REQUEST_TIMEOUT_MS, TRANSPORT_ERROR } from './api';

function jsonResponse(init: { ok: boolean; status: number; body: unknown }) {
  return { ok: init.ok, status: init.status, json: async () => init.body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('evaluate', () => {
  it('exposes the proxied endpoint constants', () => {
    expect(EVALUATE_URL).toBe('/api/evaluate');
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(TRANSPORT_ERROR).toBe('Could not reach the server');
  });

  it('success 200 numeric result → {ok:true,value}', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 48 } }));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: true, value: 48 });
  });

  it('422 division by zero → verbatim error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }));
    await expect(evaluate({ operation: 'divide', a: 1, b: 0 })).resolves.toEqual({ ok: false, error: 'division by zero' });
  });

  it('400 invalid input → verbatim error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, status: 400, body: { error: 'invalid input' } }));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: 'invalid input' });
  });

  it('500 internal error → verbatim error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, status: 500, body: { error: 'internal error' } }));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: 'internal error' });
  });

  it('non-2xx without an error string → TRANSPORT_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, status: 502, body: {} }));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('network failure → TRANSPORT_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('abort (AbortError) → TRANSPORT_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('non-JSON 2xx → TRANSPORT_ERROR', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async (): Promise<unknown> => { throw new SyntaxError('bad json'); } } as Response);
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('non-JSON 500 → TRANSPORT_ERROR', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async (): Promise<unknown> => { throw new SyntaxError('bad json'); } } as Response);
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('200 without a finite numeric result → TRANSPORT_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { error: 'x' } }));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: '48' } }));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('posts JSON with method POST and Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 1 } }));
    await evaluate({ operation: 'add', a: 1, b: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/evaluate');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ operation: 'add', a: 1, b: 2 });
  });

  it('unary request body has no b key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 3 } }));
    await evaluate({ operation: 'sqrt', a: 9 });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toEqual({ operation: 'sqrt', a: 9 });
    expect('b' in body).toBe(false);
  });
});
