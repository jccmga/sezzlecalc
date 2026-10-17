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
});
