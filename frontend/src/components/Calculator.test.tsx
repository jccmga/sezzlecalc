import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Calculator from './Calculator';

function jsonResponse(init: { ok: boolean; status: number; body: unknown }) {
  return { ok: init.ok, status: init.status, json: async () => init.body } as Response;
}

const display = () => screen.getByTestId('calculator-display');
const button = (name: string) => screen.getByRole('button', { name });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('Calculator', () => {
  it('starts at 0 without contacting the server', () => {
    render(<Calculator />);
    expect(display()).toHaveTextContent('0');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('T-1: binary path posts exactly one request and renders the server value', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 48 } }));
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('1'));
    await user.click(button('2'));
    await user.click(button('multiply'));
    await user.click(button('4'));
    await user.click(button('equals'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/evaluate');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ operation: 'multiply', a: 12, b: 4 });

    await waitFor(() => expect(display()).toHaveTextContent('48'));
  });

  it('T-2: unary path posts sqrt without b', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 3 } }));
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('9'));
    await user.click(button('square root'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toEqual({ operation: 'sqrt', a: 9 });
    expect('b' in body).toBe(false);

    await waitFor(() => expect(display()).toHaveTextContent('3'));
  });

  it('T-3: an empty entry blocks the request', async () => {
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('5'));
    await user.keyboard('{Backspace}');
    expect(display()).toHaveTextContent('0');

    await user.click(button('square root'));
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(display()).toHaveTextContent('0');
  });

  it('T-3b: equals with no pending operation issues no request', async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await user.click(button('equals'));
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('toggles the entry sign without a request', async () => {
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('7'));
    await user.click(button('change sign'));

    expect(display()).toHaveTextContent('-7');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('ignores a sign toggle on zero', async () => {
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('change sign'));

    expect(display()).toHaveTextContent('0');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('renders a server error verbatim', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }),
    );
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('5'));
    await user.click(button('divide'));
    await user.click(button('0'));
    await user.click(button('equals'));

    await waitFor(() => expect(display()).toHaveTextContent(/^division by zero$/));
  });

  it('clears an error back to 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }),
    );
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('5'));
    await user.click(button('divide'));
    await user.click(button('0'));
    await user.click(button('equals'));
    await waitFor(() => expect(display()).toHaveTextContent(/^division by zero$/));

    await user.click(button('clear'));

    expect(display()).toHaveTextContent('0');
  });

  it('disables keys while a request is in flight but keeps clear available', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('9'));
    await user.click(button('square root'));

    expect(screen.getByRole('region', { name: 'Calculator' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(button('7')).toBeDisabled();
    expect(button('clear')).toBeEnabled();

    await user.click(button('clear'));
    expect(display()).toHaveTextContent('0');
  });

  it('replaces the operator when a second operand is typed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 48 } }));
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('1'));
    await user.click(button('2'));
    await user.click(button('add'));
    await user.click(button('4'));
    await user.click(button('multiply'));
    await user.click(button('equals'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      operation: 'multiply',
      a: 12,
      b: 4,
    });
    await waitFor(() => expect(display()).toHaveTextContent('48'));
  });

  it('keeps the pending operation when a unary is applied to the second operand', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 3 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 12 } }));
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('9'));
    await user.click(button('add'));
    await user.click(button('3'));
    await user.click(button('square root'));
    await waitFor(() => expect(display()).toHaveTextContent('3'));
    await user.click(button('equals'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      operation: 'sqrt',
      a: 3,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      operation: 'add',
      a: 9,
      b: 3,
    });
    await waitFor(() => expect(display()).toHaveTextContent('12'));
  });

  it('evaluates keyboard entry like the keypad', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 48 } }));
    const user = userEvent.setup();
    render(<Calculator />);

    await user.keyboard('12*4{Enter}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      operation: 'multiply',
      a: 12,
      b: 4,
    });
    await waitFor(() => expect(display()).toHaveTextContent('48'));
  });

  it('C1: announces an error assertively in a single live region', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }),
    );
    const user = userEvent.setup();
    render(<Calculator />);

    // Non-error state stays polite and is not an alert.
    expect(display()).toHaveAttribute('aria-live', 'polite');
    expect(display()).not.toHaveAttribute('role');

    await user.click(button('5'));
    await user.click(button('divide'));
    await user.click(button('0'));
    await user.click(button('equals'));

    await waitFor(() => expect(display()).toHaveTextContent(/^division by zero$/));

    expect(display()).toHaveAttribute('role', 'alert');
    expect(display()).not.toHaveAttribute('aria-live'); // dropped entirely in error
    expect(display()).toBeVisible();
    expect(display().textContent).toBe('division by zero');
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="alert"]')[0]).toBe(display());
    expect(document.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
    expect(screen.getAllByText('division by zero')).toHaveLength(1);
  });

  it('C2: clears the previous result when an error replaces it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 48 } }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }),
      );
    const user = userEvent.setup();
    render(<Calculator />);

    // 12 × 4 = → 48
    await user.click(button('1'));
    await user.click(button('2'));
    await user.click(button('multiply'));
    await user.click(button('4'));
    await user.click(button('equals'));
    await waitFor(() => expect(display()).toHaveTextContent('48'));

    // 5 ÷ 0 = → error
    await user.click(button('5'));
    await user.click(button('divide'));
    await user.click(button('0'));
    await user.click(button('equals'));
    await waitFor(() => expect(display()).toHaveTextContent(/^division by zero$/));

    expect(display().textContent).toBe('division by zero');
    expect(display()).not.toHaveTextContent('48');

    const callsBefore = fetchMock.mock.calls.length;
    await user.click(button('equals'));
    expect(fetchMock).toHaveBeenCalledTimes(callsBefore);
  });

  it('C3: shows the transport error, keeps rendering, and re-enables the keypad', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('9'));
    await user.click(button('square root'));

    await waitFor(() => expect(display()).toHaveTextContent('Could not reach the server'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(display()).toBeInTheDocument();
    expect(display().textContent).toBe('Could not reach the server');
    expect(screen.getByRole('region', { name: 'Calculator' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
    for (const key of screen.getAllByRole('button')) {
      expect(key).toBeEnabled();
    }
  });

  it('C4: a fresh calculation after an error issues a new request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }),
    );
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('5'));
    await user.click(button('divide'));
    await user.click(button('0'));
    await user.click(button('equals'));
    await waitFor(() => expect(display()).toHaveTextContent(/^division by zero$/));

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 4 } }));

    await user.click(button('2')); // clears the error, starts a fresh entry
    await user.click(button('add'));
    await user.click(button('2'));
    await user.click(button('equals'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondInit = fetchMock.mock.calls[1][1];
    expect(fetchMock.mock.calls[1][0]).toBe('/api/evaluate');
    expect(JSON.parse(secondInit?.body as string)).toEqual({
      operation: 'add',
      a: 2,
      b: 2,
    });

    await waitFor(() => expect(display().textContent).toBe('4'));
    expect(display()).not.toHaveTextContent('division by zero');
  });

  it('C3b: a non-JSON success body shows the transport error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async (): Promise<unknown> => { throw new SyntaxError('bad json'); },
    } as Response);
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(button('9'));
    await user.click(button('square root'));

    await waitFor(() => expect(display()).toHaveTextContent('Could not reach the server'));
    expect(screen.getByRole('region', { name: 'Calculator' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
    for (const key of screen.getAllByRole('button')) {
      expect(key).toBeEnabled();
    }
  });
});
