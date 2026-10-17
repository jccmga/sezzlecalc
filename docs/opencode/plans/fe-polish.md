# Plan: Frontend Polish — Assertive Errors, Transport UX, Retry, and 320 px Layout

- **PRD:** `docs/opencode/prds/fe-polish.md`
- **Scope:** Frontend only. Audit-and-fix of 5 criteria. No rewrite; preserve all working behavior.
- **Contract source of truth:** `.opencode/skills/api-contract/SKILL.md` (unchanged by this plan).

---

## 1. Context & Goals

### Problem
The calculator UI already satisfies four of the five requested behaviors *at the reducer/transport level*, but:

1. **C1 (real defect):** `Display.tsx` renders the single display as `<output aria-live="polite">` unconditionally (verified at `frontend/src/components/Display.tsx:16-19`). Server/transport errors are therefore announced **politely**, not assertively. There is no `role="alert"` and no assertive region anywhere in `frontend/src` (grep over `frontend/src` finds exactly one `aria-live` usage — `Display.tsx:17` — and zero `role="alert"`/`aria-hidden`).
2. **C2 (behavior correct, no test):** `calculator-machine.ts:111` already clears `entry`, `lhs`, and `operator` on every failed resolution (the `preserve` flag is ignored on the error branch), and `Display.tsx:12` already renders only the error text. There is no reducer unit test and no component test proving a prior result is gone.
3. **C3 (behavior correct, no test):** `api.ts:23-59` is total — `fetch` rejection (`api.ts:55-56`), `response.json()` failure (`api.ts:38-40`), and malformed bodies (`api.ts:47`) all return `{ ok: false, error: TRANSPORT_ERROR }`; it never rejects. Module tests exist (`api.test.ts:47-65`), but there is no **component-level** test that the display shows the transport message and the keypad re-enables.
4. **C4 (behavior correct, no test):** `calculator-machine.ts:43-46, 58-60` reset `error`/`status` to `editing` on digit/decimal, and `Calculator.tsx:28` re-enables evaluation once out of `error`. No test covers the second request.
5. **C5 (real defect + unverified):** row-1 spanning keys `√` and `xʸ` have no square sibling, so their height is content-driven (`py-2` 16px + `text-sm` 20px line-height = ~36px), below 44px (PRD §7.2). Width math fits 320px, but horizontal scroll is unmeasured (jsdom has no layout engine).

### Desired outcome
Fix C1 and C5 with minimal source edits; add regression tests that lock down C2, C3, and C4; perform (and record) the manual 320px visual check for C5.

### Explicit non-goals (from PRD §1.2)
- No backend, contract, request/response, or error-taxonomy changes (NG-1).
- No rewrite of `Calculator.tsx`/`Display.tsx`/reducer; no hooks/context extraction (NG-2).
- No auto-retry, Retry button, toasts, error history, or error mapping (NG-3).
- No redesign; only the minimum `min-h-11` class for tap targets (NG-4).
- No new dependencies (no Playwright, no layout shims, no `jest-axe`) (NG-5).
- No screen-reader automation; C1 is verified at the DOM/ARIA level (NG-6).
- No formatting/validation/keyboard/request-construction changes (NG-7).
- No sub-320px support (NG-8).

---

## 2. Approach

### Chosen design (per PRD §3–§7 + two resolved clarifications)

**C1 — assertive error announcement (clarification #1 applies).**
Keep the single `<output>` display element. Derive its announcement semantics from the already-computed `isError` flag (`Display.tsx:11`):

```tsx
<output
  role={isError ? 'alert' : undefined}
  aria-live={isError ? undefined : 'polite'}
  aria-label="Calculator display"
  data-testid="calculator-display"
  ...
>
```

In the error state we set `role="alert"` **only** and **drop `aria-live` entirely**. `role="alert"` is inherently assertive *and* atomic (`aria-live="assertive"` + `aria-atomic="true"` are implied by the ARIA role), so it is a single live region with no double announcement. In non-error states the element has no explicit `role` (keeping the `<output>` implicit `status` role) and `aria-live="polite"`. **No second live region is added**; the message exists exactly once in the DOM.

This **supersedes PRD §3.4/§3.5**, which proposed *also* setting `aria-live="assertive"` in the error state. Per clarification #1 we do **not** set `aria-live="assertive"`; the test asserts the attribute is absent in the error state.

**C2/C3/C4 — tests only.** No source change to `calculator-machine.ts`, `api.ts`, or `Calculator.tsx`'s dispatch path. Behavior is already correct (verified: `calculator-machine.ts:101-112`; `api.ts:23-59`; `Calculator.tsx:25-39, 116, 157`).

**C5 — class-only tap-target fix.** Append `min-h-11` (44px) to both key `className` branches in `Calculator.tsx:159`. Square keys already render 58px wide/tall at 320px, so `min-height` has no visual effect on them; only row 1 (`√`, `xʸ`) grows from ~36px to 44px. The `0` spanning key shares a row with square keys and already stretches to 58px; the same fix covers any browser that fails to stretch it. Horizontal scroll at 320px is **not** computed by code — it is a manual/visual check.

### Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| `role="alert"` + `aria-live="assertive"` on the same element (PRD §3.4 default) | **Rejected by clarification #1**: redundant on one region and leaves an inspectable `aria-live="assertive"` that reads as a *second* mechanism; the clarified contract is `role="alert"` only, no `aria-live` in error. |
| A second hidden live region (e.g. a visually-hidden `<span role="alert">`) | Violates the single-live-region / no-double-announcement requirement (PRD §3.4). |
| Unconditional `role="alert"` on the display | Would announce every digit/result as an alert (PRD §3.4). |
| `aria-live="assertive"` without `role="alert"` | Does not give the atomic/alert semantics required; `role="alert"` is the explicit, testable signal. |
| A `.catch()` or error boundary in `Calculator.tsx` | `evaluate` is total by design (never rejects); adding defensive handling is scope creep (PRD §5.3, NG-2/NG-3). |
| `aspect-square` on spanning keys to force height | Would inflate `√`/`xʸ` to ~124px tall (PRD §7.4). |
| Fixed `h-11` on all keys | Would cap square keys at 44px and break the 58px row rhythm (PRD §7.4). |
| `overflow-x-hidden` to hide horizontal scroll | The requirement is *no* overflow, not *hidden* overflow (PRD §7.4). |

---

## 3. File-by-file changes

| # | File | Action | Change |
|---|---|---|---|
| 1 | `frontend/src/components/Display.tsx` | **Modify** | Derive `role` and `aria-live` from `isError` (C1). No change to text, `aria-label`, `data-testid`, or `className`. |
| 2 | `frontend/src/components/Calculator.tsx` | **Modify** | Append `min-h-11` to both branches of the key `className` (C5, line 159). |
| 3 | `frontend/src/components/Calculator.test.tsx` | **Modify** | Add C1, C2, C3, C4 component tests (and optional C3b). Leave all 13 existing tests byte-for-byte unchanged. |
| 4 | `frontend/src/lib/calculator-machine.test.ts` | **New** | Reducer unit tests: C2 error-clearing (`preserve: true`), C4 digit-after-error reset. |

**No files are deleted.** No changes to `api.ts`, `calculator-machine.ts`, `format.ts`, `validation.ts`, `api.test.ts`, `format.test.ts`, `validation.test.ts`, `button.tsx`, `App.tsx`, `index.css`, `src/test/setup.ts`, `vite.config.ts`, `package.json`, the `Makefile`, or the `api-contract` skill.

### 3.1 `frontend/src/components/Display.tsx` — exact edit

`isError` is already computed at line 11. Change only the attribute block (currently lines 16-19).

**Before:**
```tsx
    <output
      aria-live="polite"
      aria-label="Calculator display"
      data-testid="calculator-display"
```

**After:**
```tsx
    <output
      role={isError ? 'alert' : undefined}
      aria-live={isError ? undefined : 'polite'}
      aria-label="Calculator display"
      data-testid="calculator-display"
```

Resulting DOM/ARIA contract:
- `status === 'error'`: element has `role="alert"` and **no** `aria-live` attribute.
- every other status (`editing`/`awaiting`/`result`/`busy`): element has **no** `role` attribute (keeps `<output>`'s implicit `status` role) and `aria-live="polite"`.

### 3.2 `frontend/src/components/Calculator.tsx` — exact edit

Line 159, current:

```tsx
className={cn(k.colSpan2 ? 'col-span-2 w-full h-auto' : 'aspect-square w-full h-auto')}
```

Change to:

```tsx
className={cn(k.colSpan2 ? 'col-span-2 w-full h-auto min-h-11' : 'aspect-square w-full h-auto min-h-11')}
```

`min-h-11` = 44px (Tailwind v4 default spacing scale: `--spacing: 0.25rem` → `11 × 0.25rem = 2.75rem = 44px`). **Third-party verification note:** tailwindcss is pinned to `^4.1.11` (`frontend/package.json:36`); the CSS-first theme at `frontend/src/index.css:48-71` overrides only `--radius-*` and `--color-*` tokens and does **not** override `--spacing`, so the default scale applies. `node_modules` is not installed in this worktree (no `frontend/node_modules/tailwindcss/package.json`), so this is verified against the Tailwind v4 documented default theme + the repo's `@theme` block, not by reading the installed package source. Flag for implementer: if the build ever warns that `min-h-11` is unknown (it will not with v4 defaults), fall back to `min-h-[44px]`.

### 3.3 `frontend/src/lib/calculator-machine.test.ts` — new file (exact tests)

Uses the existing `@/` alias (`vite.config.ts:9-13`) and vitest globals (`vite.config.ts:26` `globals: true`). Imports mirror `calculator-machine.ts:1-3`.

```ts
import { describe, expect, it } from 'vitest';
import { reducer, type CalculatorState } from './calculator-machine';
```

**Test 1 (mandatory — C2 / AC-STALE-1 + AC-STALE-2):**

```ts
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

- Renders: n/a (pure reducer).
- Asserts: deep-equality to the fully cleared error state with `preserve: true` — proves a prior `entry`/`lhs`/`operator` cannot survive a unary-style (`preserve: true`) failure.
- Closure: the assertion is `toEqual` on the exact expected object; if the error branch ever preserved `lhs`/`operator` or kept `entry`, the test fails.

**Test 2 (supporting — C4 support, per PRD §10.1):**

```ts
it('C4 (reducer): a digit after error clears the error and returns to editing', () => {
  const before: CalculatorState = {
    entry: '', lhs: null, operator: null, status: 'error', error: 'division by zero',
  };
  const after = reducer(before, { type: 'digit', d: '2' });
  expect(after).toEqual({
    entry: '2', lhs: null, operator: null, status: 'editing', error: null,
  });
});
```

- Asserts: digit out of `error` → `status: 'editing'`, `error: null`, `entry: '2'` — the reducer precondition for the C4 component flow.

*(Optional, recommended but not required:* a `preserve: false` variant of Test 1 to document that the error branch ignores `preserve` both ways. It is not strictly necessary because the error branch (`calculator-machine.ts:111`) never reads `preserve`; Test 1 already proves the point.)

### 3.4 `frontend/src/components/Calculator.test.tsx` — added tests (exact)

These reuse the existing helpers at the top of the file — `jsonResponse` (line 6-8), `display()` (line 10), `button(name)` (line 11), and the `fetchMock` stub in `beforeEach` (lines 13-18). `src/test/setup.ts` already does `cleanup()` + `vi.unstubAllGlobals()` per test. Insert the new `it(...)` blocks inside the existing `describe('Calculator', ...)` (after line 219, before the closing `});` at line 220). **Do not modify any existing test.**

**C1 test:**

```tsx
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
```

- **Renders:** `<Calculator />` with a 422 `division by zero` stub; drives `5 ÷ 0 =`.
- **Asserts:** polite + no explicit `role` before the error; `role="alert"` and **no** `aria-live` after; visible; exact `textContent`; exactly one `[role="alert"]` (the display), zero `[aria-live="assertive"]`, zero `[aria-live="polite"]`, and the error string exactly once in the document.
- **Closure:** the count assertions (`toHaveLength(1)` for alert, `toHaveLength(0)` for both `aria-live` flavors, `getAllByText(...).toHaveLength(1)`) are the RTL-level proof of "one region, no double announcement".

**C2 test (integration):**

```tsx
it('C2: clears the previous result when an error replaces it', async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 48 } }))
    .mockResolvedValueOnce(jsonResponse({ ok: false, status: 422, body: { error: 'division by zero' } }));
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

  const callsBefore = fetchMock.mock.calls.length; // === 2
  await user.click(button('equals'));
  expect(fetchMock).toHaveBeenCalledTimes(callsBefore); // no stale request
});
```

- **Renders:** `<Calculator />` with two stubbed responses: 200 `{result:48}` then 422 `division by zero`.
- **Asserts:** after success the display is `48`; after the error the `textContent` is exactly `division by zero` with no `48`; pressing `=` while in error issues no additional request (call count unchanged at 2).
- **Closure:** `expect(display().textContent).toBe('division by zero')` + `not.toHaveTextContent('48')` proves no stale number; the call-count assertion proves no stale operand is re-sent (AC-STALE-4).

**C3 test:**

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

- **Renders:** `<Calculator />` with `fetch` rejecting (`TypeError('Failed to fetch')`); drives `9 √`.
- **Asserts:** exactly one request; display still in the document with exact `textContent` `Could not reach the server`; `aria-busy="false"` on the region; every button (all 21) enabled.
- **Closure:** reaching the post-`waitFor` assertions after a rejection proves the component neither threw nor unmounted (no error boundary is added — its absence is the point, PRD §5.3).

**C4 test:**

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
```

- **Renders:** `<Calculator />` with a 422 failure then a 200 `{result:4}`; drives `5 ÷ 0 =` then `2 + 2 =`.
- **Asserts:** exactly 2 requests; the second request URL is `/api/evaluate` and body is `{operation:'add', a:2, b:2}`; the display becomes `4` and the error text is gone.
- **Closure:** `toHaveBeenCalledTimes(2)` (not 3) proves no automatic retry (AC-RETRY-4); the decoded body proves the *new* operands were sent (AC-RETRY-2).

**C3b (optional, recommended — AC-TRANSPORT-5):**

```tsx
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

  await waitFor(() =>
    expect(display()).toHaveTextContent('Could not reach the server'),
  );
  expect(screen.getByRole('region', { name: 'Calculator' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  for (const key of screen.getAllByRole('button')) {
    expect(key).toBeEnabled();
  }
});
```

---

## 4. Data, API & schema impact

- **API contract:** none. `.opencode/skills/api-contract/SKILL.md` is unchanged; no request/response shape, URL, method, header, or error-string change. `EVALUATE_URL`/`API_BASE_URL`/`VITE_API_BASE_URL` (`api.ts:11-17`) untouched.
- **Schema/migrations/persistence:** none (project has none).
- **Config/env:** none. No new env var; `VITE_API_BASE_URL` semantics unchanged.
- **Dependencies:** none added/removed (`frontend/package.json` unchanged).
- **Downstream consumers:** the display's ARIA attributes are read by assistive technology only; the key `min-h-11` is presentational. No programmatic consumer reads either.

---

## 5. Test strategy

### 5.1 Files and tests

| File | Tests |
|---|---|
| `frontend/src/lib/calculator-machine.test.ts` (**new**) | `C2: clears entry, lhs, and operator on any failed resolution`; `C4 (reducer): a digit after error clears the error and returns to editing` |
| `frontend/src/components/Calculator.test.tsx` (**edit**) | `C1: announces an error assertively in a single live region`; `C2: clears the previous result when an error replaces it`; `C3: shows the transport error, keeps rendering, and re-enables the keypad`; `C4: a fresh calculation after an error issues a new request`; optional `C3b: a non-JSON success body shows the transport error` |

**Test quality rules (PRD §10.3):** await I/O with `waitFor`/`findBy*`; stub `fetch` per test (already the suite's pattern); no fake timers; query display by `data-testid` and keys by role+name; do not weaken existing tests.

### 5.2 Traceability — PRD acceptance criteria → plan step → test

| Criterion | Acceptance criteria | Plan step (file) | Covering test / check |
|---|---|---|---|
| C1 Assertive error | AC-ERR-1 (`role="alert"`, no `aria-live` in error) | §3.1 `Display.tsx` | `C1: announces an error assertively in a single live region` |
| C1 | AC-ERR-2 (polite + non-alert in all non-error states) | §3.1 `Display.tsx` | same C1 test (pre-error assertions) |
| C1 | AC-ERR-3 (one alert, zero polite/assertive regions, message once) | §3.1 | same C1 test (count assertions) |
| C1 | AC-ERR-4 (exact text, present & visible) | §3.1 | same C1 test (`textContent` + `toBeVisible`) |
| C2 Stale cleared | AC-STALE-1 (resolve failure from prior-value state clears all) | §3.3 test 1 | `C2: clears entry, lhs, and operator on any failed resolution` |
| C2 | AC-STALE-2 (`preserve: true` unary failure also clears) | §3.3 test 1 | same reducer test (`preserve: true`) |
| C2 | AC-STALE-3 (component: no prior number beside error) | §3.4 C2 | `C2: clears the previous result when an error replaces it` |
| C2 | AC-STALE-4 (`=` in error issues no request) | §3.4 C2 | same C2 test (call-count assertion) |
| C3 Transport UI | AC-TRANSPORT-1 (exact `Could not reach the server`) | §3.4 C3 | `C3: shows the transport error, keeps rendering, and re-enables the keypad` |
| C3 | AC-TRANSPORT-2 (region stays mounted, no throw) | §3.4 C3 | same C3 test (`toBeInTheDocument`, assertions reached) |
| C3 | AC-TRANSPORT-3 (`aria-busy=false`, all keys enabled) | §3.4 C3 | same C3 test (`aria-busy` + per-button `toBeEnabled`) |
| C3 | AC-TRANSPORT-4 (exactly one request) | §3.4 C3 | same C3 test (`toHaveBeenCalledTimes(1)`) |
| C3 | AC-TRANSPORT-5 (optional: non-JSON 2xx) | §3.4 C3b | optional `C3b: a non-JSON success body shows the transport error` |
| C4 Retry | AC-RETRY-1 (digit clears error) | §3.3 test 2 + §3.4 C4 | `C4 (reducer): ...` + `C4: a fresh calculation after an error issues a new request` |
| C4 | AC-RETRY-2 (one additional request, new operands) | §3.4 C4 | same C4 component test (calls=2 + body decode) |
| C4 | AC-RETRY-3 (new result rendered, error gone) | §3.4 C4 | same C4 component test (`display` = `4`, `not.toHaveTextContent('division by zero')`) |
| C4 | AC-RETRY-4 (no auto retry; total = 2 not 3) | §3.4 C4 | same C4 component test (`toHaveBeenCalledTimes(2)`) |
| C5 320px | AC-MOBILE-1 (no horizontal scroll at 320px) | §3.2 + **MANUAL** | **MANUAL browser check** (no automated test) |
| C5 | AC-MOBILE-2 (all 21 keys ≥ 44×44 incl. √, xʸ, 0) | §3.2 + **MANUAL** | **MANUAL browser measurement** |
| C5 | AC-MOBILE-3 (no automated layout assertion) | — | Absence of layout assertions in tests is itself the proof |
| C5 | AC-MOBILE-4 (explicit verification sentence recorded) | — | **MANUAL**; QA must record the exact statement (§7 below) |
| Preservation | PRD §11 (existing behavior intact) | — | Existing 13 `Calculator` tests + `api`/`format`/`validation` tests unchanged and passing |

---

## 6. Risks & edge cases

- **Dynamic role/`aria-live` swap across AT:** switching the same element from polite→alert is not spoken identically by every screen reader. The clarified contract (single element, `role="alert"` only in error) minimizes this; PRD §3.6 flags the residual limitation. RTL proves the DOM/ARIA contract, not actual speech (NG-6).
- **Double announcement:** prevented structurally — one live region, error text rendered once. If a future edit adds a second region, the C1 count assertions fail.
- **`toBeVisible()` under `css: false`:** `vite.config.ts:29` sets `css: false`, so jsdom applies no stylesheet. `@testing-library/jest-dom`'s `toBeVisible` still passes for an element with no `display:none`/`visibility:hidden`/`hidden`/`aria-hidden`/zero-opacity inline style — which is exactly this display's case. Not a flake risk here; noted so no one "fixes" it by adding CSS shims (NG-5).
- **`min-h-11` vs. Tailwind version:** if `min-h-11` were unexpectedly absent, row-1 keys stay ~36px and only the manual check would catch it. Fallback `min-h-[44px]` documented in §3.2.
- **Stale-request token:** `requestToken` increment on `clear` and unmount (`Calculator.tsx:31, 62, 112`) already guards against out-of-order responses; untouched.
- **Concurrency:** at most one request in flight; `begin`/`resolve` + the `status === 'busy'` guard (`Calculator.tsx:28`) enforce it. Tests add no timers; rejections resolve as microtasks (PRD §8).
- **320px width math assumes no horizontal overflow** (PRD §7.2 shows 58px single cells). If the manual check disproves this, the permitted class-only fallback is smaller shell/card padding or `min-w-0` on the grid (PRD §7.4) — flagged as a contingency, not pre-applied.

---

## 7. Rollout & rollback

- **No flags, no config toggles, no migrations.** The change is source-only and fully revertible via `git revert` of the three edited files (plus the new test file).
- **Sequencing (small, reviewable steps):**
  1. `Display.tsx` C1 edit (independent; safe alone).
  2. `Calculator.tsx` `min-h-11` C5 edit (independent; safe alone).
  3. New `calculator-machine.test.ts` (pure unit tests).
  4. New cases in `Calculator.test.tsx`.
- **Rollback:** revert each file independently; reverting `Display.tsx` restores polite-only announcements; reverting `Calculator.tsx` restores ~36px row-1 keys. No data or contract is affected.
- **Verification gates before declaring done** (see §7 of PRD "Definition of done"): lint, unit tests, build, and the manual 320px check.

---

## 8. Open questions

All six PRD §12.2 questions were resolved by the two clarifications; none blocks coding. The remaining item for a human to confirm before sign-off:

1. **C1 sign-off gate (PRD Q-1):** is the DOM/ARIA assertion level sufficient, or is a manual VoiceOver/NVDA spot check required for C1? Default per clarification: DOM/ARIA assertions are the gate; an AT spot check is optional and, if performed and it fails, the fallback is a single persistent assertive region (still one region). **Confirm the gate level before final sign-off.**
2. *(Informational, not blocking)* The C1 clarification intentionally diverges from PRD §3.4/§3.5 (no `aria-live="assertive"`). This plan documents the supersession; no edit to the PRD is required unless the reviewer wants the historical spec amended.

---

## Appendix A — QA verification command sequence (exact)

Run from the repo root. Commands are the canonical `Makefile` targets; underlying commands shown in parentheses.

1. **Lint (frontend):**
   ```
   make frontend-lint        # cd frontend && npm run lint   → eslint .
   ```
2. **Unit/component tests (frontend):**
   ```
   make frontend-test        # cd frontend && npm run test   → vitest run
   ```
3. **Typecheck + production build (frontend):**
   ```
   make frontend-build       # cd frontend && npm run build  → tsc -b && vite build
   ```
   > `frontend/package.json` has **no separate `typecheck` script**; `npm run build` runs `tsc -b` first, so `make frontend-build` **is the typecheck gate**.
4. **Full gate (backend untouched but must stay green):**
   ```
   make check                # backend-build backend-test backend-vet frontend-test frontend-lint frontend-build
   ```
5. **MANUAL — 320 px layout check (C5).** This is **not** automatable and **must** be performed by a human in a real browser. Protocol (PRD §7.6):
   - `cd frontend && npm run dev` (backend optional; stop the backend to also exercise the long transport error).
   - Chrome DevTools device toolbar → custom **320 × 568** viewport, reloaded at that size.
   - Run in the console:
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
   - **Pass conditions:** `horizontalOverflow === false`, `viewport === 320`, and every entry in `targets` has `w >= 44 && h >= 44`.
   - QA must record **verbatim** the statement (this is a deliverable, not optional — PRD §7.6):
     > 320 px visual check: **visually verified** in `<browser + version>` at 320×568 CSS px. No horizontal scroll (`scrollWidth === 320`); all 21 keys measured ≥ 44×44 px.
     >
     > *(add the measured minimum, e.g. "min 44×44" or "min 58×58", if convenient)*
