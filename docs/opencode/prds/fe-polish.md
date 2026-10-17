# PRD: Frontend Polish — Assertive Errors, Transport UX, Retry, and 320 px Layout

- **Status:** Ready for planning with explicit defaults; 6 open questions in §12, none blocks design (Q-1/Q-2 merit a confirmation)
- **Owner:** Frontend / TPM
- **Date:** 2026-10-17
- **Repo/worktree:** `sezzlecalc`, worktree `fe-polish`
- **Scope level:** Frontend only. Audit-and-fix of `frontend/src` plus tests. No rewrite.
- **Contract source of truth:** `.opencode/skills/api-contract/SKILL.md` (unchanged)
- **Prior design context:** `docs/opencode/prds/frontend-calculator.md`
- **Raw request:** audit the calculator UI against 5 criteria and fix only what is missing.

---

## 1. Goal

Make the existing calculator UI satisfy five specific polish criteria while preserving every
behavior that already works. This is an **audit-and-fix**, not a redesign:

1. Server/transport errors are announced **assertively** (not politely), without double
   announcement, while remaining visible in the display.
2. A stale result is **cleared** when an error replaces it, and that is locked down by a test.
3. A **transport failure renders in the UI** without throwing and re-enables the keypad.
4. **Retry after an error** issues a fresh request for a newly entered calculation.
5. At a **320 px viewport** there is no horizontal scroll and every key is at least
   **44 × 44 CSS px**; confirmed visually because RTL cannot compute layout.

### 1.1 Audit verdict (source-level, before any change)

| # | Criterion | Verdict from source | Work required |
|---|-----------|--------------------|---------------|
| C1 | Assertive error announcement | **FAIL** — the error renders inside `<output aria-live="polite">`; no `role="alert"` and no assertive live region. | Change `Display.tsx` attributes + tests |
| C2 | Stale result cleared on error | **PASS behaviorally** — the reducer clears `entry`, `lhs`, `operator`; the display renders only the error. | Tests only |
| C3 | Transport failure in the UI | **PASS behaviorally** — `evaluate` never rejects; `error` status re-enables keys. | Tests only |
| C4 | Retry after error | **PASS behaviorally** — a digit after `error` returns to `editing` and clears `error`. | Tests only |
| C5 | 320 px layout | **FAIL (tap targets) + UNVERIFIED (scroll)** — width math fits, but row-1 keys are ~36 px tall; horizontal scroll is unproven. | One class fix + mandatory manual check |

**Expected source diff:** `Display.tsx` (ARIA attributes), `Calculator.tsx` (one Tailwind class
addition), `Calculator.test.tsx` (new cases), new `calculator-machine.test.ts` (unit cases).
No changes to `api.ts`, `calculator-machine.ts`, `format.ts`, `validation.ts`, the reducer
semantics, or the REST contract.

### 1.2 Non-goals (explicitly out of scope)

| ID | Out of scope |
|----|--------------|
| NG-1 | Backend, `api-contract`, request/response shapes, error taxonomy |
| NG-2 | Rewriting `Calculator.tsx`, `Display.tsx`, or the reducer; extracting hooks/context |
| NG-3 | New behavior such as auto-retry, a "Retry" button, error history, toasts, or error mapping |
| NG-4 | Redesigning the visual system; only the minimum class change for tap targets is allowed |
| NG-5 | Adding Playwright, jsdom layout shims, `jest-axe`, or any new dependency |
| NG-6 | Screen-reader automation; announcement is verified at the DOM/ARIA level (+ optional manual spot check) |
| NG-7 | Changing formatting, validation, keyboard handling, or request construction |
| NG-8 | Supporting viewports below 320 px |

---

## 2. Baseline: what the code does today

All line references are to the audited worktree.

| Area | Source | Observed behavior |
|---|---|---|
| Display element | `frontend/src/components/Display.tsx:16-17` | `<output aria-live="polite" aria-label="Calculator display" data-testid="calculator-display">` |
| Display text precedence | `Display.tsx:12` | `status === 'error' ? (error ?? 'Unknown error') : entry === '' ? '0' : entry` |
| Display error styling | `Display.tsx:13, 22` | `text-lg break-words`, `whitespace-normal` |
| Error passed to display | `Calculator.tsx:145, 148` | `aria-busy={isBusy}` on the section; `error={state.error}` |
| Error resolution | `frontend/src/lib/calculator-machine.ts:101-112` | `{ ok:false }` → `{ entry: '', lhs: null, operator: null, status: 'error', error }` (line 111) |
| Guard on evaluation | `Calculator.tsx:28` | `evaluateCurrent` returns early when `status` is `busy` or `error` |
| Request dispatch | `Calculator.tsx:31-36` | Token increment, `begin`, `evaluate(...).then(resolve)`; no `.catch` (not needed) |
| Busy/disabled | `Calculator.tsx:116, 157` | `isBusy = status === 'busy'`; only `AC` stays enabled while busy |
| Transport layer | `frontend/src/lib/api.ts:21, 23-59` | `TRANSPORT_ERROR = 'Could not reach the server'`; catch-all returns `{ok:false,error}`; never throws/rejects |
| Non-JSON handling | `api.ts:36-40, 55-56` | `response.json()` failure and fetch rejection both map to `TRANSPORT_ERROR` |
| Digit after error | `calculator-machine.ts:43-46` | `error`/`result` + digit → `entry = d`, `status = 'editing'`, `error = null` |
| Decimal after error | `calculator-machine.ts:58-60` | Same reset to `editing`, `entry = '0.'` |
| Operator after error | `calculator-machine.ts:90` | Ignored while `status === 'error'` |
| Existing error tests | `Calculator.test.tsx:105-118, 120-136` | Verbatim `division by zero`; `AC` clears to `0` |
| Existing transport tests | `api.test.ts:47-50, 57-64` | Module-level rejection/non-JSON → `TRANSPORT_ERROR`; **no component-level test** |
| Existing retry tests | none | No test covers a second request after an error |
| Shell/layout | `App.tsx:5`; `Calculator.tsx:146, 150, 159`; `button.tsx:11, 26-31` | `main p-4`; card `w-full max-w-[360px] p-4`; grid `grid-cols-4 gap-2`; keys `aspect-square` or `col-span-2 h-auto`; `Button` base `py-2 text-sm` |
| Viewport meta | `frontend/index.html:5` | `width=device-width, initial-scale=1.0` |

There is exactly **one** live region in `frontend/src` (the display); there are no other
`aria-live`, `role="alert"`, or `aria-hidden` usages. This matters for the no-double-announcement
requirement.

---

## 3. Criterion 1 — Error announcement is assertive

### 3.1 Requirement

When `status === 'error'`:

- The error must be announced **immediately** (assertive), via `role="alert"` and/or
  `aria-live="assertive"`.
- The same message must **not** be announced twice (no second live region carrying the same text,
  no simultaneous polite + assertive copies).
- The error text must remain **visible in the display** (a calculator shows its error in the
  display; no toast-only or hidden-only presentation).
- Non-error announcements (digits, results) must keep their existing polite behavior.

### 3.2 Current behavior

`Display.tsx:16-17` always renders `<output aria-live="polite">`. The error text is placed inside
that same polite region by `Display.tsx:12`. There is no `role="alert"` and no assertive
politeness anywhere in `frontend/src` (grep-confirmed). Errors are also inside a section that
briefly has `aria-busy="true"` (`Calculator.tsx:145`), which clears when the state moves to
`error`.

### 3.3 Gap

Politeness is `polite`, so the message is queued behind other speech rather than announced
immediately. There is no assertive/alert semantic. The visibility requirement is already met and
must not change.

### 3.4 Required change (minimal)

In `Display.tsx`, keep the single `<output>` and derive the announcement semantics from the
already-computed `isError` flag:

```
role={isError ? 'alert' : undefined}
aria-live={isError ? 'assertive' : 'polite'}
```

Constraints:

- **Do not** add `role="alert"` unconditionally; non-error digits/results must not become alerts.
- **Do not** render a second hidden live region. The display is the only live region, so the
  message exists exactly once in the DOM.
- `<output>` has an implicit `status` role (a polite live region). In the error state the explicit
  `role="alert"` overrides that implicit role; in non-error states the element remains an output
  and is explicitly polite. Do not add a separate wrapper role.
- Do not remove or change `aria-busy` on the section (`Calculator.tsx:145`). The request is busy
  while in flight; the error commit sets `aria-busy="false"` and the error text together. Removing
  `aria-busy` to "force" an announcement would break the existing busy semantics (AC-A5 in the
  prior PRD).
- Do not change the rendered text, `aria-label`, `data-testid`, or styling.
- Setting both `role="alert"` and `aria-live="assertive"` on the same element is **one** live
  region, not two announcements. The redundancy is intentional so tests and AT agree (see §12 Q-1
  for the alternative if the reviewer prefers role-only).

### 3.5 Acceptance criteria

- **AC-ERR-1** — In `status === 'error'`, the element returned by
  `screen.getByTestId('calculator-display')` has `role="alert"` and `aria-live="assertive"`.
- **AC-ERR-2** — In every non-error status (initial, editing, awaiting, result, busy), the display
  has `aria-live="polite"` and is **not** an alert.
- **AC-ERR-3** — While an error is displayed, there is exactly one `role="alert"` element,
  exactly one assertive live region, zero polite live regions, and the error string occurs exactly
  once in the document.
- **AC-ERR-4** — The display's `textContent` equals the error string exactly, and the element is
  present and visible (not `display:none`, `visibility:hidden`, or `aria-hidden`).

Exact assertions for the mandatory test (extend `Calculator.test.tsx`):

```tsx
it('C1: announces an error assertively in a single live region', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }),
  );
  const user = userEvent.setup();
  render(<Calculator />);

  // Non-error state remains polite and is not an alert.
  expect(display()).toHaveAttribute('aria-live', 'polite');
  expect(display()).not.toHaveAttribute('role', 'alert');

  await user.click(button('5'));
  await user.click(button('divide'));
  await user.click(button('0'));
  await user.click(button('equals'));

  await waitFor(() => expect(display()).toHaveTextContent(/^division by zero$/));

  expect(display()).toHaveAttribute('role', 'alert');
  expect(display()).toHaveAttribute('aria-live', 'assertive');
  expect(display()).toBeVisible();
  expect(display().textContent).toBe('division by zero');
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(document.querySelectorAll('[role="alert"]')[0]).toBe(display());
  expect(document.querySelectorAll('[aria-live="assertive"]')).toHaveLength(1);
  expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
  expect(screen.getAllByText('division by zero')).toHaveLength(1);
});
```

The count assertions are the RTL-level proof of "no double announcement": one live region, one
copy of the message, no simultaneous polite region.

### 3.6 Limitation (must be stated in review)

RTL/jsdom can prove the ARIA contract above; it **cannot** prove what a screen reader actually
speaks. A manual VoiceOver/NVDA spot check is recommended but is not a hard gate by default
(§12 Q-1). If the dynamic role swap is found to be unreliable in the target AT, the fallback is a
single persistent assertive region per the note in §12 — not a second visible copy.

---

## 4. Criterion 2 — Stale results are cleared on error

### 4.1 Requirement

The display must never show a previous number alongside an error. On a non-`ok` outcome the
previous result/entry must be cleared in state, and the display must show only the error text.
A test must assert this.

### 4.2 Current behavior

`calculator-machine.ts:111` returns `{ entry: '', lhs: null, operator: null, status: 'error',
error }` for every failed resolution, including unary failures (`preserve` is ignored on the error
branch). `Display.tsx:12` chooses the error text exclusively when `isError`, so an old `entry`
would not be rendered even if it survived. An empty `entry` also renders as `0` only in non-error
states.

The closest existing coverage is `Calculator.test.tsx:105-118`, which enters `5 ÷ 0 =` from a
fresh calculator and asserts `/^division by zero$/`. It never first shows a computed number, and
there is no reducer unit test file at all.

### 4.3 Gap

Behavior is correct; **regression coverage is missing**. No code change is warranted, and none
should be made. Adding an `entry = ''`-style guard to `Display` would be redundant behavior
change; do not do it.

### 4.4 Acceptance criteria

- **AC-STALE-1** — Reducer unit test: a `resolve` failure from a state that holds a prior value
  yields exactly `{ entry: '', lhs: null, operator: null, status: 'error', error: <message> }`.
- **AC-STALE-2** — The same holds when `preserve: true` (unary failure), proving pending
  `lhs`/`operator` cannot survive an error.
- **AC-STALE-3** — Component test: after a successful `12 × 4 =` showing `48`, a failed
  `5 ÷ 0 =` leaves the display's `textContent` exactly `division by zero`, with no `48` anywhere
  in the display.
- **AC-STALE-4** — Pressing `=` while in the error state issues no request (no stale operand is
  re-sent).

Mandatory reducer test (new `frontend/src/lib/calculator-machine.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { reducer, type CalculatorState } from './calculator-machine';

it('C2: clears entry, lhs, and operator on any failed resolution', () => {
  const before: CalculatorState = {
    entry: '48', lhs: 12, operator: 'add', status: 'busy', error: null,
  };
  const after = reducer(before, {
    type: 'resolve',
    outcome: { ok: false, error: 'division by zero' },
    preserve: true,
  });
  expect(after).toEqual({
    entry: '', lhs: null, operator: null, status: 'error', error: 'division by zero',
  });
});
```

Mandatory component assertions (may extend the existing "renders a server error verbatim" test,
but keep that test's intent):

```tsx
// First: 12 × 4 = → 48
// Then:  5 ÷ 0 = → error
await waitFor(() => expect(display()).toHaveTextContent(/^division by zero$/));
expect(display().textContent).toBe('division by zero');
expect(display()).not.toHaveTextContent('48');

const callsBefore = fetchMock.mock.calls.length;
await user.click(button('equals'));
expect(fetchMock).toHaveBeenCalledTimes(callsBefore); // no stale request
```

---

## 5. Criterion 3 — Transport failure renders in the UI

### 5.1 Requirement

When `fetch` rejects (or resolves with a non-JSON body), the UI must:

- show the transport message **`Could not reach the server`** in the display;
- not throw or unmount the calculator;
- re-enable the keypad after the failure resolves.

### 5.2 Current behavior

`api.ts:23-59` wraps the request in `try/catch/finally`; `fetch` rejection (`api.ts:55-56`),
`response.json()` failure (`api.ts:38-40`), and malformed success bodies (`api.ts:47`) all return
`{ ok: false, error: TRANSPORT_ERROR }`. The function is total: it never rejects. Module-level
coverage exists at `api.test.ts:47-50` (rejected `TypeError`) and `api.test.ts:57-64` (non-JSON).

`Calculator.tsx:33-36` applies the outcome; `calculator-machine.ts:111` moves to `error`.
`Calculator.tsx:116, 157` derives `isBusy` from `status`, so after resolution the keypad is
enabled again (`AC` was enabled throughout).

### 5.3 Gap

The component-level path is untested, so a future change that lets `evaluate` reject (for example,
removing the catch in `api.ts`), an accidental `throw`, or a change to the disabled predicate
could regress it silently. Behavior itself needs no change; do not add an error boundary or a
defensive `.catch` in the component (the API is total by design).

### 5.4 Acceptance criteria

- **AC-TRANSPORT-1** — With `fetch` rejecting `new TypeError('Failed to fetch')`, the display's
  `textContent` is exactly `Could not reach the server`.
- **AC-TRANSPORT-2** — The `Calculator` region remains mounted and the display remains present
  after the rejection (the test completes with no thrown error/unhandled rejection).
- **AC-TRANSPORT-3** — After resolution, `aria-busy` on the region is `"false"` and every keypad
  button is enabled (including `equals`, `7`, `square root`, and `clear`).
- **AC-TRANSPORT-4** — Exactly one request was issued for the failed press; there is no retry.
- **AC-TRANSPORT-5 (optional hardening)** — A 2xx with a non-JSON body produces the same display
  text and enabled state. The request permits either rejection **or** non-JSON; rejection is the
  mandatory case, non-JSON is recommended.

Exact mandatory test:

```tsx
it('C3: shows the transport error, keeps rendering, and re-enables the keypad', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const user = userEvent.setup();
  render(<Calculator />);

  await user.click(button('9'));
  await user.click(button('square root'));

  await waitFor(() =>
    expect(display()).toHaveTextContent('Could not reach the server'),
  );

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
```

"Component does not throw" is demonstrated by the test reaching these assertions after
`waitFor`; no error boundary should be introduced to satisfy it.

---

## 6. Criterion 4 — Retry works after an error

### 6.1 Requirement

After a failed evaluation, entering a **new** calculation and pressing `=` must issue a **new**
request. This is manual re-entry, not an automatic retry and not a Retry control.

### 6.2 Current behavior

On error the reducer clears `entry`, `lhs`, and `operator` (`calculator-machine.ts:111`).
A digit (line 46) or decimal (line 60) in `error` transitions to `editing` and clears `error`.
Operator input then stores a fresh `lhs` (`line 97`), and `=` passes the `evaluateCurrent` guard
(`Calculator.tsx:28`) because the status is no longer `error`. A new request token is taken at
`Calculator.tsx:31`, so the new response is authoritative.

Pressing an operator or a unary **directly** while the error is still displayed is intentionally a
no-op: `Calculator.tsx:28` returns early and `calculator-machine.ts:70, 90` ignore the action.
The retry flow therefore starts with a digit or decimal point.

### 6.3 Gap

Behavior is correct; no test covers the second request. No source change is needed.

### 6.4 Acceptance criteria

- **AC-RETRY-1** — After a failed evaluation, a digit transitions the display out of the error and
  the error text is gone.
- **AC-RETRY-2** — Completing a new calculation and pressing `=` issues exactly one additional
  request (`fetch` total = 2) with the new operands.
- **AC-RETRY-3** — The new successful result is rendered and the error text is no longer shown.
- **AC-RETRY-4** — No automatic retry occurs: the failed request is not re-sent; total calls after
  the retry equal 2, not 3.

Exact test:

```tsx
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

  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ok: true, status: 200, body: { result: 4 } }),
  );

  await user.click(button('2')); // clears error, starts a fresh entry
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
```

A transport-failure variant (reject first, then succeed) is optional and exercises the same
state machine; the 422 version is mandatory because it is deterministic and does not depend on
the transport stub.

---

## 7. Criterion 5 — 320 px layout (manual/visual)

### 7.1 Requirement

At a **320 CSS px** viewport:

- There is **no horizontal scroll** (content is not clipped and does not overflow sideways).
- Every tappable key is at least **44 × 44 CSS px**, including the spanning keys `√`, `xʸ`, and
  `0`.
- If either fails, adjust Tailwind classes (minimal change; no redesign).

### 7.2 Current behavior (class-derived; must be confirmed visually)

- `index.html:5` sets `width=device-width, initial-scale=1.0`.
- `App.tsx:5`: `main` has `p-4` (16 px each side).
- `Calculator.tsx:146`: card is `w-full max-w-[360px] ... p-4` (16 px each side).
- `Calculator.tsx:150`: `grid grid-cols-4 gap-2` (8 px gaps below `sm`).
- `Calculator.tsx:159`: single-cell keys are `aspect-square w-full h-auto`; spanning keys are
  `col-span-2 w-full h-auto` with no `aspect-square`.
- `button.tsx:11, 27`: base `text-sm` (line-height 1.25rem = 20 px) and default size `py-2`
  (8 px top/bottom).

Width math at 320 px:

```
viewport                    320
main padding (p-4)          -32   → 288
card padding (p-4)          -32   → 256
grid gaps (3 × 8)           -24   → 232
per single column           232/4 → 58 px
```

So single-cell keys render at **58 × 58** and the card fits horizontally. The spanning key `0`
shares a row with `aspect-square` keys and is expected to stretch to the 58 px row height; if any
browser does not stretch it, the same `min-h-11` fix covers it.

**Row 1 is different:** it contains only `√` and `xʸ`, both spanning two columns, neither with an
aspect ratio and neither with a square sibling to size the row. Their height is content-driven:
`py-2` (16 px) + `text-sm` line-height (20 px) = **~36 px**, below 44 px. (The default `h-9` is
also 36 px if it were not overridden; `h-auto` overrides it, with the same result.) This is the
tap-target gap.

### 7.3 Gap

1. **Tap targets:** `√` and `xʸ` are ~36 px tall at every viewport width, not just 320 px. This
   fails the ≥44 px criterion.
2. **Horizontal scroll:** class math says it fits, but this has not been measured. jsdom has no
   layout engine (`getBoundingClientRect()` and `scrollWidth` are not meaningful), so it must be
   checked in a real browser.

### 7.4 Required change (class-only)

Add a 44 px minimum height to every calculator key in `Calculator.tsx:159`, e.g. append
`min-h-11` (Tailwind v4: `11 × 0.25rem = 2.75rem = 44px`) to both the `col-span-2` and
`aspect-square` branches of the key `className`. Applying it to all keys is safe: the square keys
render at 58 px, so `min-height` has no visual effect on them; only row 1 grows from ~36 to
44 px.

Do **not**:

- add `aspect-square` to the spanning keys (that would make them ~124 px tall);
- set a fixed `h-11` (it would cap the square keys and break the row rhythm);
- use `overflow-x-hidden` to hide a horizontal overflow (the requirement is no overflow, not
  hidden overflow);
- change the grid columns, gaps, card padding, or `max-w-[360px]` unless the manual check proves
  a failure that `min-h-11` does not fix.

If the manual check reveals horizontal overflow (not expected), the permitted fallback is a
smaller base padding on the card/shell or `min-w-0` on the grid; any such change must remain
class-only and must not alter DOM structure or behavior.

### 7.5 Acceptance criteria (manual; no RTL test may claim these)

- **AC-MOBILE-1** — At a 320 px viewport, `document.documentElement.scrollWidth <=
  window.innerWidth` (i.e. no horizontal scroll/bounce), and every part of the card and all 21
  keys are reachable without sideways scrolling.
- **AC-MOBILE-2** — Every key's `getBoundingClientRect()` reports `width >= 44` **and**
  `height >= 44` CSS px at 320 px. This explicitly includes `square root`, `power`, and `0`.
- **AC-MOBILE-3** — No automated test asserts layout. jsdom cannot compute layout, so the visual
  check is the sole evidence.
- **AC-MOBILE-4** — The implementation/QA report contains an explicit verification sentence (see
  §7.6). A silent "tests pass" is not acceptable evidence for this criterion.

### 7.6 Manual verification protocol (required)

1. Run the frontend (`npm run dev` in `frontend/`; the backend is not needed for layout, but
   starting it lets you also check the long transport error).
2. Open Chrome DevTools device toolbar, set a **custom 320 × 568** viewport (or 320 × 640), with
   the page reloaded at that size.
3. Run in the console:

```js
({
  viewport: window.innerWidth,
  horizontalOverflow:
    document.documentElement.scrollWidth > window.innerWidth,
  targets: [...document.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    return {
      name: b.getAttribute('aria-label') ?? b.textContent?.trim(),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  }),
})
```

4. Pass conditions: `horizontalOverflow === false`, `viewport === 320`, and every entry in
   `targets` has `w >= 44 && h >= 44`.
5. Optional: trigger an error (stop the backend, press `9` then `square root`) and confirm
   `Could not reach the server` stays inside the card, wraps, and does not create horizontal
   overflow.
6. Record the exact statement in the PR description or QA note:

   > 320 px visual check: **visually verified** in `<browser + version>` at 320×568 CSS px.
   > No horizontal scroll (`scrollWidth === 320`); all 21 keys measured ≥ 44×44 px.

   Add the measured minimum (`min width × height`) if convenient.

This statement is a deliverable, not an optional note.

---

## 8. Performance and resource boundaries

These are hard boundaries for the change and for its tests.

| Boundary | Rule |
|---|---|
| Requests added by C1 | **Zero**. Announcement is a render/ARIA concern. |
| Requests for a failed transport press | **Exactly one**; failure does not trigger a retry. |
| Requests for the retry flow (C4) | **Exactly two total**: one failed + one retried. No auto-resend, no queue. |
| Concurrent requests | **≤ 1** in flight; retry only after the failure resolves and the user re-enters. |
| Timeout | Unchanged: `REQUEST_TIMEOUT_MS = 10_000` (`api.ts:19, 25`); the timer is cleared in `finally`. |
| Timers added by tests | **None.** Rejections resolve as microtasks; no fake timers, no `waitFor` polling assumptions beyond the default. |
| Network in tests | **Zero.** `fetch` is always stubbed (`Calculator.test.tsx:15-18`, `api.test.ts:10-13`). |
| Renders added | Only the normal state transition render; no effect, subscription, or interval. |
| Client arithmetic | None; all computed values still come from the server. |
| Bundle/deps | No new dependency; no new module. |
| Layout | CSS-only change (`min-h-11`), no JS measurement at runtime. |
| Polling / retries / debounce | None. Unchanged from the prior design. |

---

## 9. System inputs, outputs, and transitions

### 9.1 Scenario matrix

| # | Input (user + stub) | State transition | Display output | ARIA output | Network |
|---|---|---|---|---|---|
| 1 | `5 ÷ 0 =`; fetch 422 `division by zero` | `busy` → `error` | exactly `division by zero` (no prior number) | `role=alert`, `aria-live=assertive`; `aria-busy=false` | 1 request |
| 2 | `12 × 4 =` → 48, then `5 ÷ 0 =`; 200 then 422 | `result` → `busy` → `error` | exactly `division by zero`; `48` gone | alert/assertive | 2 requests (1 per `=`) |
| 3 | `9 √`; fetch rejects | `busy` → `error` | exactly `Could not reach the server` | alert/assertive; all keys enabled | 1 request |
| 4 | `9 √`; fetch 200 non-JSON | `busy` → `error` | exactly `Could not reach the server` | alert/assertive; all keys enabled | 1 request |
| 5 | error → digit `2` | `error` → `editing` | `2`; error gone | `aria-live=polite`, no alert | 0 requests |
| 6 | error → `=` | `error` (no-op) | error unchanged | alert/assertive unchanged | 0 requests (no stale send) |
| 7 | error → `2 + 2 =`; 200 `{result:4}` | `error` → `editing` → `awaiting` → `busy` → `result` | `4` | polite, no alert | 1 new request (2 total) |
| 8 | error → `÷` (operator first) | `error` (ignored) | error unchanged | alert/assertive | 0 requests |
| 9 | 320 px viewport, no interaction | render only | unchanged | section `aria-busy=false` | 0 requests |

### 9.2 State invariants (must remain true)

- `error !== null` **iff** `status === 'error'`, and in that state `entry === ''`, `lhs === null`,
  `operator === null`.
- The display has exactly one text source: `error` in `error`, otherwise `entry`, with `''` →
  `0`.
- At most one live region exists, and its politeness is assertive **only** in `error`.
- Every key is enabled whenever `status !== 'busy'`; `AC` is enabled in every status.
- No request is issued on mount, for digits/`.`/`±`/`AC`/Backspace, or for an operator press.

---

## 10. Test plan

### 10.1 Files

| File | Change |
|---|---|
| `frontend/src/components/Calculator.test.tsx` | Add C1, C2 (integration assertions), C3, C4 cases. Keep all existing tests unchanged. Optionally add the non-JSON transport variant. |
| `frontend/src/lib/calculator-machine.test.ts` | **New file.** Reducer error-clearing cases (C2) and a digit-after-error case (C4 support). |
| `frontend/src/lib/api.test.ts` | Unchanged; already covers rejection and non-JSON at the module boundary. |
| `frontend/src/lib/format.test.ts`, `validation.test.ts` | Unchanged. |

### 10.2 Case list and traceability

| Test (suggested name) | Covers | Key assertions |
|---|---|---|
| `C1: announces an error assertively in a single live region` | AC-ERR-1…4 | `role=alert`, `aria-live=assertive`, exactly one alert/assertive region, zero polite regions, text once, polite + non-alert before the error |
| `C2: clears the previous result when an error replaces it` | AC-STALE-3, AC-STALE-4 | exact `textContent === 'division by zero'`, no `48`, `=` after error issues no request |
| `C2: clears entry, lhs, and operator on any failed resolution` (reducer) | AC-STALE-1, AC-STALE-2 | deep-equal to the fully cleared error state, with `preserve: true` |
| `C3: shows the transport error, keeps rendering, and re-enables the keypad` | AC-TRANSPORT-1…4 | exact transport text, region still mounted, `aria-busy=false`, every button enabled, 1 fetch |
| `C4: a fresh calculation after an error issues a new request` | AC-RETRY-1…4 | 2 fetches, second body `{add,2,2}`, display `4`, error gone |
| `C1b: keeps polite announcements for a normal result` (optional; folded into C1) | AC-ERR-2 | result state remains `aria-live=polite`, not alert |
| `C3b: a non-JSON success body shows the transport error` (optional) | AC-TRANSPORT-5 | same as C3 with a `json()` that throws |

### 10.3 Test quality rules

- Await every request-driven assertion with `waitFor`/`findBy*`; never assert immediately after a
  click that triggers I/O.
- Stub `fetch` per test; `src/test/setup.ts:5-8` already cleans up and unstubs globals.
- Do not use fake timers or real network.
- Query the display by `data-testid` and the keys by role + accessible name, consistent with the
  existing suite.
- Do not weaken or rewrite existing test expectations. The prior 13 `Calculator` tests and all
  `api`/`format`/`validation` tests must pass unchanged (except for additive cases).

---

## 11. Preservation contract (do not change)

The following already meet their criteria and are **out of bounds**:

| Behavior | Evidence | Must remain |
|---|---|---|
| Zero requests on mount; initial `0` | `Calculator.test.tsx:21-25` | Yes |
| Binary request shape `{operation,a,b}` and URL `/api/evaluate` | `Calculator.test.tsx:27-46` | Yes |
| Unary request omits `b` | `Calculator.test.tsx:48-62` | Yes |
| Invalid entry blocks requests | `Calculator.test.tsx:64-82` | Yes |
| Sign toggle and keyboard entry | `Calculator.test.tsx:84-103, 205-219` | Yes |
| Busy disables all keys except `AC` | `Calculator.test.tsx:138-155` | Yes |
| Server error string rendered verbatim | `Calculator.test.tsx:105-118` | Yes |
| `AC` clears an error to `0` | `Calculator.test.tsx:120-136` | Yes |
| Operator replacement, unary-with-pending-op | `Calculator.test.tsx:157-203` | Yes |
| Formatting/validation/API semantics | `format.test.ts`, `validation.test.ts`, `api.test.ts` | Yes |
| REST contract | `.opencode/skills/api-contract/SKILL.md` | Yes |
| DOM structure, key names, focus ring, variants | `Calculator.tsx:118-164`, `button.tsx` | Yes |

The **only** intentional behavior change is error politeness (`polite` → `alert`/`assertive`) and
the **only** visual change is a 44 px minimum height on keys (row 1 only, in practice).

---

## 12. Ambiguities, breaking changes, and open questions

### 12.1 Breaking/irreversible changes

**None to data, API, contract, or persistence.** The change is source-only and revertible.

| ID | Flag | Assessment |
|---|---|---|
| BC-1 | Error announcements change from polite to assertive | Intended by the request; user-visible for screen-reader users only. Not a contract break. |
| BC-2 | `docs/opencode/prds/frontend-calculator.md` AC-A2 (unconditional `aria-live="polite"`) is now conditional | The prior PRD's statement is superseded **in the error state only**. This PRD is authoritative for the new behavior. The prior document should not be rewritten as part of implementation unless the orchestrator wants the historical spec amended. |
| BC-3 | Prior AC-L3 ("non-spanning keys ≥44×44") is tightened | The new requirement applies ≥44×44 to **all** keys, including spanning keys. This PRD supersedes the narrower reading. |
| BC-4 | `min-h-11` changes row-1 height by ~8 px | Cosmetic/layout only; no DOM ordering or behavior change. Revertible. |

No irreversible decisions, migrations, or schema changes. No feature flag is needed.

### 12.2 Open questions for the orchestrator/user

| ID | Question | Default if unanswered | Blocking? |
|---|---|---|---|
| Q-1 | Is a **manual screen-reader spot check** required for C1 sign-off, or are the DOM/ARIA assertions sufficient? RTL cannot prove what is spoken, and dynamic `aria-live`/role changes are not announced identically by every AT. | DOM/ARIA assertions are the gate; a VoiceOver/NVDA spot check is recommended and recorded if performed. If it fails, use the single persistent assertive region fallback (still one region; the visible display must not remain polite in error). | No; confirm the gate level |
| Q-2 | For "no double announcement", is setting **both** `role="alert"` and `aria-live="assertive"` on the same element acceptable? They are one region, but a strict reading might prefer only one attribute. | Use both on the single display (explicit + inspectable). Alternative: `role="alert"` only, drop `aria-live` in error, and assert `role` + absence of a polite region. | No; technical default chosen |
| Q-3 | Does "retry" mean **manual re-entry** only, or should a Retry control/auto-resend be added? | Manual re-entry, exactly as the request's wording says ("entering a new calculation and pressing ="). No new control, no auto-retry. | No; scope guard |
| Q-4 | Must the non-JSON variant be tested in addition to the rejected-fetch case? The request says "rejects (or resolves non-JSON)". | Rejection is mandatory; non-JSON is optional hardening. | No |
| Q-5 | Is the ≥44 px tap-target rule intended to include the spanning keys `√`, `xʸ`, `0`? | Yes, every key's rendered box. | No |
| Q-6 | Should the prior `frontend-calculator.md` AC-A2 be edited in place to describe conditional politeness? | No; this PRD supersedes it in the error state. Keep the prior doc as the historical design record. | No |

If Q-1 or Q-2 is answered differently, only the C1 implementation/test assertions change; the
other four criteria are unaffected.

---

## 13. Definition of done

1. `Display.tsx` renders `role="alert"` + `aria-live="assertive"` **only** in `error`; all other
   states stay polite and non-alert; the message is visible and appears once.
2. `Calculator.tsx` keys have a 44 px minimum height (`min-h-11`), with no other layout or
   behavior change.
3. The new C1–C4 tests (component + reducer) pass and are traceable to AC-ERR, AC-STALE,
   AC-TRANSPORT, AC-RETRY.
4. All pre-existing frontend tests pass unchanged.
5. The 320 px manual check is performed in a real browser and the exact verification statement
   from §7.6 is recorded. No automated test claims to verify layout.
6. Gates pass using the repo's canonical entry points: `make frontend-test`,
   `make frontend-lint`, `make frontend-build` (underlying: `npm run test`, `npm run lint`,
   `npm run build`); `make check` also passes (backend is untouched).
7. No new dependencies; no changes outside `Display.tsx`, `Calculator.tsx`, `Calculator.test.tsx`,
   and the new `calculator-machine.test.ts`.
8. No change to `api.ts`, `calculator-machine.ts`, `format.ts`, `validation.ts`, the backend, or
   the API contract.

### 13.1 Traceability summary

| Criterion | Acceptance criteria | Primary proof |
|---|---|---|
| C1 Assertive error | AC-ERR-1…4 | Component test: role/live attributes, single region, message once |
| C2 Stale cleared | AC-STALE-1…4 | Reducer unit test + integration exact-text/no-prior-number/no stale request |
| C3 Transport UI | AC-TRANSPORT-1…4 (5 optional) | Component test with rejected fetch: text, mounted region, enabled keys |
| C4 Retry | AC-RETRY-1…4 | Component test: 2 requests, new body, new result |
| C5 320 px | AC-MOBILE-1…4 | Manual browser measurement + explicit statement |
| Preservation | §11 | Existing suite + gates |
