# PRD: Frontend Scaffold + Happy-Path Calculator (`frontend/`)

- **Status:** Ready for design/planning — decisions are closed (see §11); no blocking open questions
- **Owner:** Frontend / TPM
- **Source of truth (contract):** `.opencode/skills/api-contract/SKILL.md`
- **Backend (frozen for this feature):** `backend/internal/httpapi` + `cmd/server`, already built and verified
- **Depends on:** the delivered backend (`POST /evaluate`, `GET /health` on `:8080`)
- **Repo:** `sezzlecalc` (Go backend + React/Vite/TS frontend)
- **Scope level:** Frontend only. Scaffold + happy-path calculator + four mandated test scenarios. No backend change, no Docker, no docs rewrite.

---

## 1. Goal

Create `frontend/` (Vite + React + TypeScript + Vitest + React Testing Library + shadcn/ui) and
ship a working calculator UI that **delegates every computed value to the backend**.

Concretely:

1. Scaffold a Vite + React + TypeScript app with npm scripts that satisfy the existing root
   `Makefile` targets (`test`, `lint`, `build`).
2. Build one calculator screen: an elevated card with a right-aligned display and a key grid
   (§4) that is responsive down to a 320 px viewport.
3. Implement the **single-operation state machine** in §5: digits/`.` build an entry, a binary
   operator stores `a` and selects the operation, `=` sends one request, `√`/`%` send one
   request immediately, and every displayed computed value comes from the server.
4. Add three pure modules — `src/lib/api.ts`, `src/lib/validation.ts`, `src/lib/format.ts` —
   with the contracts in §6.
5. Configure the Vite dev proxy `/api` → `http://localhost:8080` (§7) so the backend stays
   CORS-free.
6. Deliver the four mandated test scenarios (§9.2) plus the supporting unit tests in §9.3.

The calculator never performs arithmetic. The only client-side value changes are textual
(`±` sign editing, digit/`.`/Backspace editing) and **display formatting**.

### 1.1 Success statement

A user opens the app with the backend running, presses `1 2 × 4 =`, sees `48`, and the network
panel shows exactly one `POST /api/evaluate` (proxied to `/evaluate`) with
`{"operation":"multiply","a":12,"b":4}`. With the backend stopped, the UI still renders and a
computed key press shows `Could not reach the server` instead of throwing.

---

## 2. Out of scope / non-goals

| ID | Out of scope | Note |
|----|--------------|------|
| NG-1 | Any backend change | Backend, contract, and `Makefile` are frozen. No CORS middleware. |
| NG-2 | Docker packaging, compose, production serving | Later phase. The build must produce static assets only. |
| NG-3 | Expression parser, precedence, parentheses, multi-operand expressions, operator chaining with server evaluation | One binary operation at a time (§5). Operator presses never evaluate. |
| NG-4 | Memory keys (M+, MR), history tape, unit conversion, themes | Not requested. |
| NG-5 | Persistence, auth, i18n, CI/CD, observability, rate limiting | Repo-wide out of scope (`AGENTS.md`). |
| NG-6 | Detailed error/accessibility hardening beyond §4.4 and §5 | No full WCAG audit, no screen-reader matrix, no focus trap, no roving tabindex. |
| NG-7 | Rewriting server error strings into friendlier copy | The server string is rendered verbatim, per `api-contract`. |
| NG-8 | A digit-count cap, input masking, or thousands separators | Only the `parseEntry` finiteness guard applies. |
| NG-9 | Keyboard shortcuts for `√`, `xʸ`, `%`, `±` | Only the keys listed in §5.4 are mapped. |
| NG-10 | `README.md`, `PROMPTS.md`, `docs/ai/*` updates | Documentation phase, not this feature. |
| NG-11 | Cross-browser/visual-regression testing | jsdom tests only (§9). |

---

## 3. Background & current state (verified in this worktree)

- **No `frontend/` directory exists.** The repository root contains `.opencode/`, `backend/`,
  `docs/`, `Makefile`, `README.md`, `PROMPTS.md`, `opencode.json`, `AGENTS.md`, `.gitignore`.
- **The backend implements the full contract.** Routes are registered as plain paths on a stdlib
  `http.ServeMux` (`backend/internal/httpapi/httpapi.go:44-49`): `POST /evaluate` and
  `GET /health`. There is **no `/api` prefix** on the server. `cmd/server` listens on `:8080`.
- **Request shape** (`httpapi.go:53-57`): `{"operation": string, "a": *float64, "b": *float64}`.
  - `a` is required for every operation.
  - `b` is **required** for `add`/`subtract`/`multiply`/`divide`/`power`, and must be
    **omitted or `null`** for `sqrt`/`percent` (a numeric `b` on a unary op → `400`).
- **Response shapes** (`httpapi.go:59-65`): success `200 {"result": <number>}`; error
  `{"error":"<fixed-string>"}` with **no** `result` key. The server does no rounding — the raw
  JSON number is sent.
- **Error vocabulary** (`httpapi.go:199-234`): `400 invalid input`; `422 division by zero`;
  `422 square root of negative number`; `422 invalid operation`; `422 non-finite result`;
  plus `405 method not allowed` and `500 internal error`. The frontend renders these strings
  verbatim and adds only one string of its own: the transport message (§6.1).
- **`Makefile` already declares frontend targets** (`Makefile:29-39`) and `check` runs them
  (`Makefile:15`):
  - `frontend-install` → `cd frontend && npm install`
  - `frontend-test` → `npm run test`
  - `frontend-lint` → `npm run lint`
  - `frontend-build` → `npm run build`
  ➜ Creating `frontend/` **activates** these gates; the scaffold must define all three scripts
  or `make check` breaks (see BR-1).
- `.gitignore` already ignores `node_modules` (`node_modules` on line 83), so no ignore change is
  needed for dependencies; build output (`frontend/dist`) is **not** ignored today and must be
  added (BR-2).

### 3.1 Contract facts the UI must respect (no re-derivation)

| Contract fact | Consequence in this PRD |
|---|---|
| Binary ops take `a` and `b` | `=` sends both; `power` is binary |
| Unary ops take `a` only and **omit `b`** | `√`/`%` send `{operation, a}` — never `b`, never `b: null` |
| `percent(a) = a / 100` | `%` on `50` displays `0.5` (no `%` suffix) |
| `200` body has `result`, no `error` | Client reads `result` only |
| `4xx` body has `error`, no `result` | Client reads `error` only; never fabricates a message |
| All results are finite by contract | `formatNumber` treats non-finite as an unreachable defensive case |
| Backend serves `/evaluate`, not `/api/evaluate` | The dev proxy **must strip** the `/api` prefix (§7) |

---

## 4. UI / layout specification

### 4.1 Shell

```
<main>                                     centered page: min-height 100dvh, grid place-items-center, p-4
  └─ <section aria-label="Calculator">     the card: w-full max-w-[360px], rounded-3xl, elevated, p-4 sm:p-5
       ├─ <output>                         display panel (§4.2)
       └─ <div role="group" aria-label="Keypad">   4-column grid
            └─ <Button> × 21               keys (§4.3)
```

- Card: rounded corners (≥ `rounded-2xl`), visible elevation (shadow) and a hairline border, so it
  reads as a calculator, not a web form. Exact radius/shadow/palette are the implementer's to
  refine.
- **Centered, `max-width: 360px`**, and it must not overflow horizontally at a **320 px**
  viewport.
- No `<input>`, `<textarea>`, `<form>`, `<select>`. No submit behavior. Keys are the only
  interactive elements.
- The page must render the full calculator **before any network call**: no fetch on mount, no
  loading skeleton, no spinner gating the keypad.

### 4.2 Display panel

- Element: `<output aria-live="polite" aria-label="Calculator display" data-testid="calculator-display">`.
- Content: right-aligned, single line for numbers, `tabular-nums`, `whitespace-nowrap`.
- Precedence (authoritative):

  ```
  displayText = status === 'error'
                  ? (error ?? 'Unknown error')
                  : entry === '' ? '0' : entry
  ```

  - While `status === 'editing' | 'awaiting' | 'result'`, the display shows `entry` **verbatim**
    (so a trailing `3.` and a `-` prefix stay visible).
  - Computed values are placed into `entry` already formatted by `formatNumber` (§6.3), so the
    display never re-formats and never re-parses mid-render.
- Sizing: panel `min-height: 96px`, content bottom-right aligned. Font size steps down for long
  strings so nothing is clipped or ellipsized:
  - numeric text length ≤ 10 → `text-4xl`; length > 10 → `text-2xl`;
  - error text → `text-lg`, `break-words`, may wrap to a maximum of 2 lines.
  (Exact px sizes are refinable; the **no clipping / no ellipsis / no mid-number wrap** rule is
  not.)
- `aria-busy="true"` is set on the calculator card while a request is in flight (§5.3). The
  display text does not change at request start.

### 4.3 Key grid

A **4-column CSS grid**, six rows, 24 cells. `gap-2 sm:gap-3`. The two scientific keys span two
columns each; `0` spans two columns.

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|-----|-------|-------|-------|-------|
| 1 (scientific strip) | `√` (spans cols 1–2) | ← | `xʸ` (spans cols 3–4) | ← |
| 2 | `AC` | `±` | `%` | `÷` |
| 3 | `7` | `8` | `9` | `×` |
| 4 | `4` | `5` | `6` | `−` |
| 5 | `1` | `2` | `3` | `+` |
| 6 | `0` (span 2) | | `.` | `=` |

- Non-spanning keys: `aspect-square w-full`, minimum hit area **44 × 44 CSS px** at 320 px.
- Spanning keys (`√`, `xʸ`, `0`): same height as their row (grid rows are sized by the square
  keys), same radius/typography. They are wide rectangles by design — the request's own `0` key
  spans two columns, so "square" applies to single-cell keys.
- Operators live in the **rightmost column** (`÷ × − +`), with `xʸ` in the strip's right half.
- Glyph code points (use these exact characters): `√` U+221A, `ʸ` U+02B8 (`xʸ`),
  `÷` U+00F7, `×` U+00D7, `−` U+2212 (minus sign, not hyphen), `±` U+00B1, `%`, `+`, `=`, `.`.

### 4.4 Key roles, variants, accessible names, and effects

`variant` refers to a shadcn `Button` variant. Add four calculator variants to `buttonVariants`
in `src/components/ui/button.tsx` (`digit`, `operator`, `equals`, `clear`) so the roles are
expressed as variants rather than ad-hoc class soup. Each must be **visually distinct**:

| Role | Treatment | Keys |
|---|---|---|
| `digit` | neutral filled surface | `0`–`9`, `.`, `±` |
| `operator` | accent (primary-tinted) | `÷ × − + xʸ √ %` |
| `equals` | primary (highest contrast, filled) | `=` |
| `clear` | subdued / muted | `AC` |

| Key | Grid cell | `variant` | Accessible name | Action (see §5) |
|---|---|---|---|---|
| `√` | r1 c1–2 | `operator` | `square root` (aria-label) | unary `sqrt` |
| `xʸ` | r1 c3–4 | `operator` | `power` (aria-label) | select `power` |
| `AC` | r2 c1 | `clear` | `clear` (aria-label) | reset |
| `±` | r2 c2 | `digit` | `change sign` (aria-label) | toggle entry sign |
| `%` | r2 c3 | `operator` | `percent` (aria-label) | unary `percent` |
| `÷` | r2 c4 | `operator` | `divide` (aria-label) | select `divide` |
| `7` `8` `9` | r3 c1–3 | `digit` | `7`, `8`, `9` (text content) | append digit |
| `×` | r3 c4 | `operator` | `multiply` (aria-label) | select `multiply` |
| `4` `5` `6` | r4 c1–3 | `digit` | `4`, `5`, `6` (text content) | append digit |
| `−` | r4 c4 | `operator` | `subtract` (aria-label) | select `subtract` |
| `1` `2` `3` | r5 c1–3 | `digit` | `1`, `2`, `3` (text content) | append digit |
| `+` | r5 c4 | `operator` | `add` (aria-label) | select `add` |
| `0` | r6 c1–2 | `digit` | `0` (text content) | append digit |
| `.` | r6 c3 | `digit` | `decimal point` (aria-label) | append decimal point |
| `=` | r6 c4 | `equals` | `equals` (aria-label) | evaluate pending binary |

Rules:

- **Every key is a real `<button type="button">`** — never a `div` with a click handler.
- Every key has an explicit accessible name. Glyph keys **must** use `aria-label` with exactly
  the string above; digits use their text content. All 21 names are unique.
- Tests must query by role + accessible name (e.g. `getByRole('button', { name: 'multiply' })`),
  never by glyph text.
- Visible focus: `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background` (or
  equivalent) on every key. Focus order follows DOM order.
- While `status === 'busy'`, every key except `AC` renders `disabled` (§5.3).

---

## 5. State machine & behavior (authoritative)

### 5.1 State

```ts
type DisplayStatus = 'editing' | 'awaiting' | 'result' | 'error' | 'busy';

interface CalculatorState {
  entry: string;                       // raw display text; '' is possible after Backspace
  lhs: number | null;                  // stored `a` after an operator key
  operator: BinaryOperation | null;    // pending binary operation
  status: DisplayStatus;
  error: string | null;                // set iff status === 'error'
}

const INITIAL: CalculatorState = {
  entry: '0', lhs: null, operator: null, status: 'editing', error: null,
};
```

`BinaryOperation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power'`;
`UnaryOperation = 'sqrt' | 'percent'` (both from `src/lib/validation.ts`, §6.2).

Status meanings:

| Status | Meaning | Digit/`.` behavior |
|---|---|---|
| `editing` | composing `entry` | append / insert decimal |
| `awaiting` | binary operator selected, no second operand typed; display still shows `lhs` | start a fresh entry |
| `result` | display holds a **computed** value (from `=` or a unary) | start a fresh entry |
| `error` | display holds a server/transport error string | start a fresh entry |
| `busy` | one request in flight | ignored (busy guard) |

Implementation location is the planner's choice (inline in `src/components/Calculator.tsx` or a
`useCalculator` hook); the transitions below are fixed.

### 5.2 Transition table

Notation: `v = parseEntry(entry)`; "ignore" = no state change **and no request**.

| # | Action | Preconditions / effects |
|---|---|---|
| B-1 | **digit `d`** | `busy` → ignore. Otherwise: if `status` is `result` or `error` → `entry = d`, `status = 'editing'`, `error = null`, `lhs`/`operator` unchanged (they are `null` after `=`, and preserved after a unary). If `status` is `awaiting` → `entry = d`, `status = 'editing'`. If `status` is `editing`: `entry === '0'` or `entry === ''` → `entry = d`; else `entry = entry + d`. |
| B-2 | **decimal `.`** | `busy` → ignore. If `status` is `result` or `error` → `entry = '0.'`, `status = 'editing'`, `error = null`. If `status` is `awaiting` → `entry = '0.'`, `status = 'editing'`. If `status` is `editing`: `entry === ''` → `entry = '0.'`; `entry` already contains `.` → ignore (at most one decimal point); else `entry = entry + '.'`. |
| B-3 | **`±`** | `busy`, `error`, `awaiting` → ignore. `entry === ''` or `v === 0` → ignore (never produce `-0`). Else toggle the leading `-` of `entry` **as text**. `status`, `lhs`, `operator` are **unchanged** (so `±` on a `result` leaves it a result: the next digit still replaces). No request, ever. |
| B-4 | **`AC`** | Always allowed, including `busy`. Increment the request token (invalidate any in-flight response), then reset to `INITIAL`. |
| B-5 | **Backspace** | `busy` or `status !== 'editing'` → ignore. Else remove the last character; if the remainder is `''` or `'-'`, set `entry = ''`. Display then falls back to `0` (§4.2). **An empty `entry` is unparsable** — this is the reachable invalid-entry path that blocks requests (B-7, B-9). |
| B-6 | **binary operator `op`** | `busy` or `error` → ignore. If `v === null` (empty/unparsable entry) → ignore. If `status === 'editing' && operator !== null` (a second operand was typed): **replace** `operator = op`, `status = 'awaiting'`; `lhs` and `entry` unchanged. Otherwise: `lhs = v`, `operator = op`, `status = 'awaiting'`. No request. |
| B-7 | **`=`** | `busy` or `error` → ignore. If `operator === null || lhs === null` → ignore. If `v === null` → ignore. Otherwise send `{ operation: operator, a: lhs, b: v }`; `status = 'busy'`. |
| B-8 | **unary `u`** (`sqrt`/`percent`) | `busy` or `error` → ignore. If `v === null` → ignore. Otherwise send `{ operation: u, a: v }`; `status = 'busy'`; `entry`, `lhs`, `operator` are left untouched for the duration. |
| B-9 | **`=` with no pending operator** | Covered by B-7: ignore, no request. |
| B-10 | **key press while `busy`** | Every action above except `AC` is a no-op (and its button is `disabled`). |

### 5.3 Responses, in-flight behavior, and staleness

At the start of every evaluating press, capture a token: `const token = ++requestToken`.

| Outcome | State after resolution |
|---|---|
| `{ok:true, value}` from `=` | `entry = formatNumber(value)`, `lhs = null`, `operator = null`, `status = 'result'`, `error = null` |
| `{ok:true, value}` from a unary | `entry = formatNumber(value)`, `status = 'result'`, `error = null`; **`lhs`/`operator` are preserved** (see B-12) |
| `{ok:false, error}` (server or transport) | `entry = ''`, `lhs = null`, `operator = null`, `status = 'error'`, `error = <message>` |

- Stale responses: if `token !== requestToken` when a response resolves, **discard it** (no state
  update). `AC` and unmount both invalidate the token.
- While `status === 'busy'`: all keys except `AC` are `disabled` **and** ignored; the card has
  `aria-busy="true"`; the display text is unchanged. This is what guarantees "exactly one
  request" for a repeated `=`/unary press.
- A response is applied at most once; there is no retry, no queue, and no debounce.
- `error` strings are rendered verbatim (`division by zero`, `invalid input`,
  `square root of negative number`, `invalid operation`, `non-finite result`,
  `Could not reach the server`). The UI never appends prefixes/suffixes and never rewrites them.

### 5.4 Keyboard

A single `window` `keydown` listener, registered in an effect and removed on unmount.

| Key(s) | Action |
|---|---|
| `0`–`9` | digit |
| `.` | decimal |
| `+` / `-` / `*` / `/` | select `add` / `subtract` / `multiply` / `divide` |
| `Enter` | `=` |
| `=` (unshifted) | `=` |
| `Backspace` | Backspace (B-5) |
| `Escape` | `AC` |
| anything else (incl. `Tab`) | ignored — **never** `preventDefault` on `Tab` |

Guards:

- Ignore the event when `event.ctrlKey || event.metaKey || event.altKey` (do not hijack browser
  shortcuts such as Cmd+R).
- If the event target is a keypad `<button>` and the key is `Enter` or ` ` (space), do nothing —
  let the native button activation fire so only the focused key acts (prevents `Enter` on a
  focused `7` from also meaning `=`).
- `preventDefault()` only for keys actually handled (notably `/` and `Backspace`).
- No key is focused on mount; no focus trap.

### 5.5 Displayed-value semantics (explicit, to avoid re-interpretation)

- The initial display is `0` and is **not** a computed value (no request on mount).
- After `=` the display shows `formatNumber(result)`; the pending operator is cleared, so a
  second `=` is a no-op (B-7).
- `12 × =` (no second operand typed) uses `b = parseEntry(entry) = 12` → `144`. This is the
  "current entry is the second operand" rule, stated explicitly because `entry` still holds `lhs`
  in `awaiting`.
- Pressing a binary operator while a second operand is typed **replaces** the operator and does
  not evaluate (`12 + 4 × =` → `{multiply, 12, 4}` = `48`). One operation at a time; no chaining.
- Unary with a pending operator: the unary acts on the current entry and its result becomes the
  **second operand**. `9 + 3 √ =` → `sqrt(3)` then `9 + 1.73205080757`. The pending `lhs`/`operator`
  are preserved across the unary so `=` still works (B-12).
- `%` is `a / 100`: `50 %` → `0.5` (no percent sign is displayed).
- `±` never computes: it edits the entry text only, so `-` is never sent as an operation and no
  unary-minus request exists.

### 5.6 Performance & resource boundaries

These are hard boundaries, not aspirations — the plan can be verified against them.

| Boundary | Rule |
|---|---|
| Requests on mount | **Zero.** No fetch, no health check, no prefetch. The first paint is fully local. |
| Requests per evaluating press | **Exactly one** (`=` with a pending op; `√`; `%`). Guarded by `busy`, not by timing. |
| Requests for other keys | **Zero** (digits, `.`, `±`, `AC`, Backspace, operator selection). |
| Concurrent requests | **≤ 1** in flight at any time; extra presses are ignored, never queued. |
| Client timeout | 10 000 ms (`REQUEST_TIMEOUT_MS`), after which the press resolves to the transport message. |
| Retries | **None.** A failed request surfaces the error; the user retries by pressing again. |
| Debounce / throttling | **None.** Local state updates are synchronous; only computed values wait on I/O. |
| Stale responses | Discarded by token; never applied after `AC` or unmount. |
| Network at test time | **Zero.** `fetch` is always stubbed. |
| Bundle surface | React + shadcn/Tailwind runtime + the three `src/lib` modules. No HTTP client, no state library, no form library, no i18n. |
| Display bound | `formatNumber` output is ≤ ~21 characters, so the display never grows unbounded. |
| DOM size | ~30 elements; no virtualization, memoization, or lazy loading is needed or expected. |
| Test runtime | The full suite runs in seconds under jsdom; no timers are waited on for the mandated tests. |

---

## 6. Module contracts

Three modules under `src/lib/`. They are pure (no React imports, no DOM, no fetch except
`api.ts`) and must be unit-testable in isolation.

### 6.1 `src/lib/api.ts`

```ts
import type { BinaryOperation, UnaryOperation } from './validation';

export type EvaluateRequest =
  | { operation: BinaryOperation; a: number; b: number }
  | { operation: UnaryOperation; a: number };

export type EvaluateOutcome =
  | { ok: true; value: number }
  | { ok: false; error: string };

export const API_BASE_URL: string;      // (import.meta.env.VITE_API_BASE_URL ?? '/api') with trailing '/' stripped
export const EVALUATE_URL: string;      // `${API_BASE_URL}/evaluate`
export const REQUEST_TIMEOUT_MS: 10_000;
export const TRANSPORT_ERROR: string;   // exactly 'Could not reach the server'

export async function evaluate(request: EvaluateRequest): Promise<EvaluateOutcome>;
```

Behavior, in order:

1. Base URL: `const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '')`.
   `VITE_API_BASE_URL` is a **base prefix** (`/api`, or `https://host/prefix`), never a full
   endpoint URL. No `.env` file is committed, so the default `/api` is the tested path.
2. Create an `AbortController`; arm `setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)`.
   Clear the timer in a `finally`.
3. `fetch(`${base}/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify(request), signal })`.
4. `response.ok` (2xx):
   - parse the body as JSON; if parsing throws → transport error;
   - if `typeof body?.result === 'number' && Number.isFinite(body.result)` →
     `{ ok: true, value: body.result }`;
   - otherwise (missing/`null`/string/non-finite `result`) → transport error. This is the
     defensive reading of "non-JSON" for an unexpected 2xx body.
5. `!response.ok` (4xx/5xx):
   - parse the body as JSON; if parsing throws → transport error;
   - if `typeof body?.error === 'string' && body.error.length > 0` →
     `{ ok: false, error: body.error }` (the server string **verbatim**, no mapping);
   - otherwise → transport error.
6. Any thrown/rejected path (network failure, abort/timeout, DNS, CORS) → `TRANSPORT_ERROR`.

Invariants:

- **Never throws and never rejects.** Both failure kinds are returned as `{ ok: false }`.
- No retries, no caching, no request queue, no interception of status codes into custom copy.
- Ignores any `result` field on an error body and any `error` field on a success body.
- The `EvaluateRequest` union makes it a type error to send `b` to a unary operation (which the
  backend rejects with `400`).

### 6.2 `src/lib/validation.ts`

```ts
export type BinaryOperation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power';
export type UnaryOperation = 'sqrt' | 'percent';
export type Operation = BinaryOperation | UnaryOperation;

export const BINARY_OPERATIONS: readonly BinaryOperation[];
export const UNARY_OPERATIONS: readonly UnaryOperation[];
export const ENTRY_PATTERN: RegExp;

export function isBinaryOperation(op: Operation): op is BinaryOperation;
export function isUnaryOperation(op: Operation): op is UnaryOperation;
export function parseEntry(raw: string): number | null;
```

`parseEntry` — the single guard between the display buffer and the wire:

1. `const s = raw.trim();` if `s === ''` → `null`.
2. If `s` does not match `ENTRY_PATTERN =
   /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/` → `null`.
   (Accepts `12`, `-5`, `3.`, `0.`, `.5`, `1e+21`, `1.5e-9` — the last two because
   `formatNumber` can produce scientific notation that must be re-parsable.)
3. `const n = Number(s);` return `Number.isFinite(n) ? n : null;`.

Rejected by design: `''`, whitespace, `'-'`, `'.'`, `'-.'`, `'abc'`, `'1,000'`, `'0x10'`,
`'Infinity'`, `'NaN'`, `'1e999'` (matches the pattern, fails `isFinite`), `' 12 34'`.
`'-0'` is accepted (`Number('-0')` is `-0`, finite) but is never produced by the UI.

The operation metadata (`BINARY_OPERATIONS` / `UNARY_OPERATIONS` / type guards) is the only
source of "binary vs unary" in the app; the component must not keep its own parallel table. It
is used to build the request union (unary ⇒ no `b` key in the body).

### 6.3 `src/lib/format.ts`

```ts
export const MAX_SIGNIFICANT_DIGITS = 12;
export function formatNumber(value: number): string;
```

One documented display rule:

1. `!Number.isFinite(value)` → `'Error'` (defensive only; the contract guarantees finite results
   and `api.ts` already maps a non-finite `result` to a transport error).
2. `value === 0` (covers `-0`) → `'0'`.
3. `let s = value.toPrecision(MAX_SIGNIFICANT_DIGITS)` — at most 12 significant digits; JS
   switches to exponential form on its own when the exponent is ≥ 12 or < −6, which satisfies
   "compact scientific notation for very large or very small magnitudes".
4. Split on `e` when present. In the mantissa (or in the whole string when there is no exponent),
   strip trailing zeros **after the decimal point**, then a trailing `.`; rejoin with the exponent
   unchanged (`e+21`, `e-7`).
5. Return `s`.

Pinned examples (these are the unit-test table):

| Input | Output | Why |
|---|---|---|
| `48` | `48` | int, trailing zeros stripped |
| `0` | `0` | literal |
| `-0` | `0` | negative zero normalized |
| `0.5` | `0.5` | |
| `-2.5` | `-2.5` | sign preserved |
| `100` | `100` | |
| `1 / 3` | `0.333333333333` | 12 significant digits |
| `Math.PI` | `3.14159265359` | 12 significant digits |
| `1e12` | `1e+12` | exponent 12 triggers exponential |
| `123456789012` | `123456789012` | exponent 11 stays plain |
| `1e21` | `1e+21` | compact scientific |
| `1e-7` | `1e-7` | compact scientific |
| `1.5e-9` | `1.5e-9` | compact scientific |
| `1e-6` | `0.000001` | boundary stays plain |
| `Infinity` / `NaN` | `Error` | defensive |

`formatNumber` is **display-only**. It is applied exactly once per computed value (when writing
`entry`), never on every render.

---

## 7. Vite dev proxy

Requirement: the backend stays CORS-free; the browser only ever calls same-origin `/api`.

```ts
// vite.config.ts (dev server only)
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),   // REQUIRED
    },
  },
},
```

- The backend routes are `/evaluate` and `/health` with **no** `/api` prefix
  (`httpapi.go:44-49`), so the prefix **must be stripped**: `/api/evaluate` →
  `http://localhost:8080/evaluate`. Omitting `rewrite` produces 404s (BR-3).
- No CORS configuration is added anywhere. Setting `VITE_API_BASE_URL` to
  `http://localhost:8080` would bypass the proxy and fail CORS — documented, not supported.
- `vite.config.ts` also carries the React plugin, the `@` → `./src` alias (required by shadcn),
  and the Vitest `test` block (§9.1). `tsconfig.app.json` must mirror the `@/*` path mapping.
- The `frontend/` app is run with `npm run dev`; the backend with
  `cd backend && go run ./cmd/server`.

---

## 8. Exact REST requests per key press

Every request is `POST ${API_BASE_URL}/evaluate` (default `/api/evaluate`, §6.1) with
`Content-Type: application/json`; values are **numbers**, never strings. Nothing else is called
(no `/health` call from the UI).

| Key press | Condition | Request body | api-contract operation |
|---|---|---|---|
| `0`–`9`, `.`, `±`, `AC`, Backspace | always | — (no request) | — |
| `+` `−` `×` `÷` `xʸ` | entry parses | — (stores `a`, selects op) | — |
| `√` | entry parses | `{"operation":"sqrt","a":9}` | `sqrt` (unary, `b` omitted) |
| `%` | entry parses | `{"operation":"percent","a":50}` | `percent` (unary, `b` omitted) |
| `=` after `+` | entry parses | `{"operation":"add","a":<lhs>,"b":<entry>}` | `add` |
| `=` after `−` | entry parses | `{"operation":"subtract","a":<lhs>,"b":<entry>}` | `subtract` |
| `=` after `×` | entry parses | `{"operation":"multiply","a":12,"b":4}` | `multiply` |
| `=` after `÷` | entry parses | `{"operation":"divide","a":<lhs>,"b":<entry>}` | `divide` (server may answer `422 division by zero`) |
| `=` after `xʸ` | entry parses | `{"operation":"power","a":<lhs>,"b":<entry>}` | `power` |
| `=` with no pending op | — | — (no request) | — |
| `=` / `√` / `%` with unparsable entry (`entry === ''`) | — | — (no request) | — |
| any key while `busy` (except `AC`) | — | — (no request) | — |

Response handling:

| Server response | Display | State |
|---|---|---|
| `200 {"result":48}` | `formatNumber(48)` → `48` | `result` |
| `422 {"error":"division by zero"}` | `division by zero` | `error` (pending op cleared) |
| `422 {"error":"square root of negative number"}` | `square root of negative number` | `error` |
| `400 {"error":"invalid input"}` | `invalid input` | `error` |
| network/timeout/non-JSON | `Could not reach the server` | `error` |

Worked traces (useful for planning tests):

- `1 2 × 4 =` → one request `{operation:'multiply', a:12, b:4}` → display `48`.
- `9 √` → one request `{operation:'sqrt', a:9}` → display `3`.
- `5 ÷ 0 =` → one request `{operation:'divide', a:5, b:0}` → display `division by zero`.
- `5 0 %` → one request `{operation:'percent', a:50}` → display `0.5`.
- `2 xʸ 1 0 =` → one request `{operation:'power', a:2, b:10}` → display `1024`.
- `7 ±` → no request; display `-7`.
- `5 Backspace √` → no request; display stays `0`.

---

## 9. Testing requirements

Stack: **Vitest + React Testing Library + `@testing-library/user-event` +
`@testing-library/jest-dom/vitest`**, `environment: 'jsdom'`.

### 9.1 Configuration

- `vite.config.ts` (`defineConfig` from `vitest/config`) includes
  `test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'],
  restoreMocks: true, css: false }`.
- `src/test/setup.ts` imports `@testing-library/jest-dom/vitest` and registers
  `afterEach(cleanup)` explicitly.
- No network access in any test: `fetch` is always stubbed (`vi.stubGlobal('fetch', vi.fn())`
  with `vi.unstubAllGlobals()` in `afterEach`).
- Tests render `<Calculator />` directly. Await async results with `findBy*`/`waitFor` (never a
  bare assertion after a click that triggers a request).
- File layout: `src/components/Calculator.test.tsx`, `src/lib/api.test.ts`,
  `src/lib/validation.test.ts`, `src/lib/format.test.ts`.

### 9.2 The four mandated scenarios (must exist, by name and assertion)

**T-1 — binary path sends exactly one request and renders the server value.**

```ts
fetch → { ok: true, status: 200, json: async () => ({ result: 48 }) }
click '1' → '2' → 'multiply' → '4' → 'equals'
```

Assertions:

- `fetch` called **exactly once** (`toHaveBeenCalledTimes(1)`).
- URL `'/api/evaluate'`; method `'POST'`; `Content-Type: application/json`.
- Body parsed → `{ operation: 'multiply', a: 12, b: 4 }` (exact deep equality; `a`/`b` are
  numbers).
- Display text becomes `48` (via `waitFor`/`findBy`).

**T-2 — unary path posts `sqrt` without `b`.**

```ts
fetch → { ok: true, status: 200, json: async () => ({ result: 3 }) }
click '9' → 'square root'
```

Assertions:

- `fetch` called exactly once; body parsed → `{ operation: 'sqrt', a: 9 }` and
  `expect('b' in body).toBe(false)`.
- Display text becomes `3`.

**T-3 — an invalid entry blocks the request (no fetch).**

```ts
render; click '5'; keyboard '{Backspace}'   // entry becomes '' → display '0'
click 'square root'
```

Assertions:

- `fetch` is **not called** (`toHaveBeenCalledTimes(0)`).
- Display still reads `0`.
- Second assertion in the same file: pressing `equals` with no pending operation issues no
  request.
- Companion unit test: `parseEntry('')`, `parseEntry('1e999')`, `parseEntry('Infinity')` are
  `null` (§9.3), proving the guard itself.

**T-4 — api client status and transport handling.**

| Case | Stub | Expected |
|---|---|---|
| success | `{ok:true, status:200, json:()=>({result:48})}` | `{ok:true, value:48}` |
| 422 | `{ok:false, status:422, json:()=>({error:'division by zero'})}` | `{ok:false, error:'division by zero'}` |
| 400 | `{ok:false, status:400, json:()=>({error:'invalid input'})}` | `{ok:false, error:'invalid input'}` |
| network | `fetch` rejects `new TypeError('Failed to fetch')` | `{ok:false, error: TRANSPORT_ERROR}` |
| non-JSON 2xx | `json` rejects | `{ok:false, error: TRANSPORT_ERROR}` |
| non-JSON 500 | `ok:false, json` rejects | `{ok:false, error: TRANSPORT_ERROR}` |
| 200 without numeric `result` | `json:()=>({error:'x'})` / `{result:'48'}` | `{ok:false, error: TRANSPORT_ERROR}` |

Each case asserts the promise **resolves** (never rejects) and that the exact string is returned
verbatim. Also assert the request init: method `POST`, `Content-Type` header, and that a unary
call's body has no `b` key.

### 9.3 Supporting unit tests (required, small)

| Module | Cases |
|---|---|
| `validation.ts` | `parseEntry` accepts `12`, `-5`, `3.`, `0.`, `.5`, `1e+21`, `1.5e-9`, `-0`; rejects `''`, `' '`, `'-'`, `'.'`, `'abc'`, `'0x10'`, `'1,000'`, `'Infinity'`, `'NaN'`, `'1e999'`; `isBinaryOperation` true for the five, false for `sqrt`/`percent` |
| `format.ts` | the full §6.3 table |
| `Calculator.tsx` (recommended) | `±` issues no request and flips the display; `AC` resets after an error; a `422` error string renders verbatim; `busy` disables keys; operator replacement (`12 + 4 × =` → multiply) |

### 9.4 Gates

- `npm run test` = `vitest run` — **non-interactive** (no watch), because `make check` calls it.
- `npm run lint` = `eslint .` — must pass with the scaffold config.
- `npm run build` = `tsc -b && vite build` — type-check + production build.
- `make frontend-install`, `make frontend-test`, `make frontend-lint`, `make frontend-build`, and
  `make check` all pass (backend gates unchanged).

---

## 10. Acceptance criteria

IDs are stable; plans and tests trace back to them. Every criterion is verifiable from source,
from `npm run test`, `npm run lint`, `npm run build`, or by inspection at 320 px.

### Scaffold & tooling (AC-S)

- **AC-S1** — `frontend/` exists as a Vite + React + TypeScript app with `package.json` scripts
  `dev`, `build` (`tsc -b && vite build`), `test` (`vitest run`), `lint` (`eslint .`).
- **AC-S2** — `make frontend-install|test|lint|build` all succeed, and `make check` passes.
- **AC-S3** — TypeScript `strict` is enabled; `tsc -b` passes; `src/` contains no `@ts-ignore`
  or `@ts-expect-error`.
- **AC-S4** — shadcn/ui is initialized: `components.json` exists, the `@` → `src` alias is
  configured in both `vite.config.ts` and `tsconfig`, `src/lib/utils.ts` exports `cn`, and every
  key renders the shadcn `Button`.
- **AC-S5** — No changes to `backend/`, `Makefile`, `.opencode/`, or the `api-contract` skill.
- **AC-S6** — `frontend/dist` (and any Vite cache) is git-ignored; no `.env` file pinning
  `VITE_API_BASE_URL` is committed.

### Layout (AC-L)

- **AC-L1** — The card is horizontally centered, `max-width: 360px`, rounded and elevated, with
  the display above the keypad.
- **AC-L2** — The key grid is 4 columns × 6 rows with exactly the contents of §4.3: the
  scientific strip (`√` span 2, `xʸ` span 2) above the four keypad rows, and `0` spanning 2
  columns.
- **AC-L3** — At a 320 px viewport there is no horizontal scrolling, and every non-spanning key
  is ≥ 44 × 44 CSS px and square (`aspect-square`).
- **AC-L4** — The display is right-aligned, numeric text is never clipped, ellipsized, or
  wrapped mid-number, and the panel is ≥ 96 px tall.
- **AC-L5** — There is no `<input>`, `<form>`, or `<select>`; all keys are `<button>`.
- **AC-L6** — The four roles (`digit`, `operator`, `equals`, `clear`) are visually
  distinguishable (neutral / accent / primary / subdued).

### Accessibility (AC-A)

- **AC-A1** — Every key is a `<button type="button">` whose accessible name matches §4.4
  exactly (glyph keys use `aria-label`).
- **AC-A2** — The display is an `<output>` with `aria-live="polite"` and
  `aria-label="Calculator display"`.
- **AC-A3** — The keyboard map of §5.4 works, `Tab` is never prevented, and `Enter` on a focused
  key activates only that key.
- **AC-A4** — Every key shows a visible focus indicator (`focus-visible` ring).
- **AC-A5** — While a request is in flight the card sets `aria-busy="true"` and only `AC` is
  enabled.
- **AC-A6** — Buttons are reachable in DOM order with no positive `tabindex` and no focus trap.

### Behavior / state machine (AC-B)

- **AC-B1** — Initial state: display `0`, `status='editing'`, and **no request on mount**.
- **AC-B2** — Digits append; `0` is replaced by the first significant digit; `.` inserts one
  decimal point (and yields `0.` from `0`/empty); a second `.` is ignored.
- **AC-B3** — `AC` resets entry, `lhs`, `operator`, `error`, and status to initial, and
  invalidates any in-flight response.
- **AC-B4** — `±` flips the entry's sign as text only, issues no request, and is a no-op on
  zero, empty, `awaiting`, and `error`.
- **AC-B5** — Backspace removes the last character in `editing`, renders `0` when the entry
  empties, and is a no-op in every other status.
- **AC-B6** — A binary operator press stores the current value as `lhs`, selects the operation,
  and issues no request.
- **AC-B7** — A binary operator press while a second operand is typed replaces the operator
  without evaluating.
- **AC-B8** — `=` sends exactly one request with `{operation: <pending>, a: <lhs>, b: <entry>}`.
- **AC-B9** — `=` with no pending operation, or with an unparsable entry, issues no request.
- **AC-B10** — After a binary `=` success the display shows `formatNumber(result)` and the
  next digit starts a fresh entry (pending operator cleared).
- **AC-B11** — `√` and `%` each send exactly one unary request for the current entry and render
  the formatted result.
- **AC-B12** — A unary result preserves a pending `lhs`/`operator`, so a following `=` uses the
  unary result as `b` (§5.5).
- **AC-B13** — Any non-`ok` outcome sets `status='error'`, renders the message verbatim, clears
  `lhs`/`operator`, and is recovered only by a digit, `.`, or `AC`.
- **AC-B14** — While `busy`, every key except `AC` is ignored and disabled.
- **AC-B15** — A response whose token is stale (invalidated by `AC`/unmount) is discarded.

### Request mapping (AC-R)

- **AC-R1** — The request URL is `${API_BASE_URL}/evaluate` with `API_BASE_URL` defaulting to
  `/api` when `VITE_API_BASE_URL` is unset.
- **AC-R2** — Every request is `POST` with `Content-Type: application/json` and a JSON body.
- **AC-R3** — Binary operations send `{operation, a, b}` with both operands as numbers.
- **AC-R4** — Unary operations send `{operation, a}` with **no `b` key**.
- **AC-R5** — No request is issued for digits, `.`, `±`, `AC`, Backspace, or an operator press.
- **AC-R6** — Exactly one request per evaluating press; no duplicates while `busy`.
- **AC-R7** — No request is issued with a non-finite or unparsable operand (`parseEntry` is the
  only source of `a`/`b`).
- **AC-R8** — `power` is selected by `xʸ` and maps to the contract operation `power`.

### Validation (AC-V)

- **AC-V1** — `parseEntry` returns `null` for empty/whitespace, malformed, and non-finite input
  (including `1e999`, `Infinity`, `NaN`).
- **AC-V2** — `parseEntry` returns a number for every entry the UI can produce, including
  formatted scientific notation (`1e+21`, `1.5e-9`).
- **AC-V3** — `parseEntry` rejects non-calculator numeric syntax (`0x10`, `1,000`).
- **AC-V4** — Operation metadata (binary vs unary) exists in exactly one place and drives
  request construction.
- **AC-V5** — A blocked (unparsable) entry produces no state change beyond the display fallback.

### Formatting (AC-F)

- **AC-F1** — `formatNumber` caps at 12 significant digits.
- **AC-F2** — Trailing zeros (and a trailing `.`) are stripped.
- **AC-F3** — `-0` formats as `0`; other negatives keep their sign.
- **AC-F4** — Magnitudes with exponent ≥ 12 or < −6 format compactly (`1e+12`, `1e-7`).
- **AC-F5** — The §6.3 example table passes exactly.
- **AC-F6** — `formatNumber` is applied once per computed value and never while typing.

### API client (AC-P)

- **AC-P1** — `evaluate` never throws/rejects; both failure kinds are returned as
  `{ok:false, error}`.
- **AC-P2** — A 2xx with a finite numeric `result` returns `{ok:true, value}`.
- **AC-P3** — A 4xx/5xx with a string `error` returns that string **verbatim**.
- **AC-P4** — Network failure, abort/timeout (10 s), and unparseable bodies return
  `Could not reach the server`.
- **AC-P5** — A 2xx without a finite numeric `result` is treated as a transport failure.
- **AC-P6** — No retries, no caching, no custom status→message mapping, no reading of `result`
  on error bodies.

### Tests (AC-T)

- **AC-T1** — T-1 exists in `Calculator.test.tsx`: one `fetch` call with
  `{operation:'multiply', a:12, b:4}`; display `48`.
- **AC-T2** — T-2 exists: one `fetch` call with `{operation:'sqrt', a:9}` and no `b`; display `3`.
- **AC-T3** — T-3 exists: an invalid (empty) entry blocks the request and `fetch` is not called;
  backed by `parseEntry` unit cases for `''`/`1e999`/`Infinity`.
- **AC-T4** — T-4 exists: status/transport handling table from §9.2.
- **AC-T5** — All tests pass under `npm run test` (`vitest run`, non-interactive) with no
  unhandled rejections or `act` warnings.
- **AC-T6** — `npm run lint` and `npm run build` pass.

### Non-goals / invariants (AC-N)

- **AC-N1** — No client-side arithmetic: no arithmetic operator is applied to a parsed operand
  anywhere in `src/` (`+` is allowed only for string concatenation while building `entry`); every
  computed display value originates from a `200 result`.
- **AC-N2** — No expression parser, precedence, parentheses, chaining, or operator-triggered
  evaluation.
- **AC-N3** — No persistence, history, or memory keys.
- **AC-N4** — No CORS, backend, or contract changes.

---

## 11. Decisions (resolved; do not re-open without a PRD change)

| # | Tension | Decision |
|---|---|---|
| D-1 | `/api` prefix vs. backend paths | Proxy **rewrites** `/api/*` → `/*` (§7). The backend has no `/api` prefix. |
| D-2 | "Exactly one request" test | A single in-flight token (`busy`) disables and ignores keys; no debounce needed. |
| D-3 | Where the invalid-entry path comes from | Backspace can empty the entry; empty ⇒ `parseEntry` `null` ⇒ blocked press. Combined with `parseEntry` unit tests. |
| D-4 | Invalid-entry UI fallback | The display renders `0` for an empty entry; `entry` itself stays `''` so the guard is real. |
| D-5 | `±` semantics | Text-only leading-sign toggle; no request; no-op on zero/empty/`awaiting`/`error`; never changes `status`. |
| D-6 | Precision after a result | Computed values enter `entry` **formatted** (12 significant digits), so chained operations use the displayed value. `1 ÷ 3 =` then `× 3 =` yields `0.999999999999`. Accepted; no hidden exact-value field. |
| D-7 | Operator press with a typed second operand | Replaces the operator; never evaluates; no chaining. |
| D-8 | Unary with a pending binary op | Applies to the current entry; the result is the next `b`; `lhs`/`operator` are preserved. |
| D-9 | `=` with no second operand typed | `b = parseEntry(entry)`, which is `lhs` in `awaiting` (`12 × =` → `144`). |
| D-10 | Number rendering | `toPrecision(12)` + trailing-zero strip; scientific notation delegated to JS thresholds (e ≥ 12, e < −6); `-0` → `0`. One rule, one function. |
| D-11 | Error presentation | Server strings verbatim; the only client-authored string is `Could not reach the server`. |
| D-12 | Key variants | Four added shadcn variants (`digit`, `operator`, `equals`, `clear`); `±` is `digit`, `√`/`%` are `operator`. |
| D-13 | Layout of the scientific strip | Same 4-column grid; `√` and `xʸ` span 2 columns each (no empty cells, aligned with the keypad). |
| D-14 | Keyboard `Enter` vs. focused button | `Enter` means `=` unless a keypad button is the event target (native activation wins). |
| D-15 | State ownership | Component-local state (or an extracted hook); no state library, no context. |

---

## 12. Risks, breaking changes, and irreversible choices

| ID | Flag | Impact / mitigation |
|---|---|---|
| **BR-1** | **Breaking for `make check`** | Creating `frontend/` activates `frontend-test`/`frontend-lint`/`frontend-build` (`Makefile:15,29-39`). The scaffold **must** define `test` (`vitest run`), `lint`, and `build`, with `node_modules` installed; otherwise the repo's canonical gate goes red. |
| **BR-2** | Repo hygiene | `frontend/dist` is not ignored today. Add it (and `.vite`/`*.tsbuildinfo`) to `.gitignore`; `node_modules` is already ignored. |
| **BR-3** | **Dev-only breaking if wrong** | The proxy rewrite is mandatory. Without it, `/api/evaluate` → backend 404. Hard-coded in `vite.config.ts`; not configurable via env. |
| **BR-4** | Irreversible-ish contract | `VITE_API_BASE_URL` is a **base prefix**, not the endpoint URL. Deployment/docs must follow this; changing it later breaks the api client. |
| **BR-5** | Coupling to generated code | Adding variants to `src/components/ui/button.tsx` is lost if shadcn regenerates the component. Noted in the file header comment; re-add after regeneration. |
| **R-1** | Precision (D-6) | Chained calculations can lose sub-display precision (`0.999999999999`). Accepted for a scaffold; revisit only if the product needs exact chains (would need an exact-value field). |
| **R-2** | Async test flakiness | Must `await` request-driven assertions (`findBy`/`waitFor`); a bare `expect` right after a click reads the pre-response DOM. |
| **R-3** | `toPrecision` boundary drift | Behavior at e = 12 / e = −6 is JS-defined; the §6.3 table pins the contract so a future refactor cannot silently change formatting. |
| **R-4** | shadcn CLI availability | If `npx shadcn@latest init/add button` cannot run (offline/registry), hand-author an equivalent `button.tsx` + `cn` + `components.json` with the same API. The ACs are behavioral, not CLI-based. |
| **R-5** | Backend absent in dev | Without the backend on `:8080`, the UI renders but computed keys show `Could not reach the server` (proxy 500/ECONNREFUSED). This is expected, and is exactly what T-4 transport coverage exercises. |
| **R-6** | 1 KiB request cap (backend) | Not a constraint here (bodies are tiny), but a future digit-cap change must not approach it. No action. |

---

## 13. Open questions for human confirmation (non-blocking; defaults are decided above)

1. **D-6 precision trade-off** — Is losing sub-display precision on chained calculations
   acceptable? *Default: yes (formatted value is the stored value).* If not, the PRD must add an
   exact-value field and a re-render rule.
2. **Deployment base path** — Will production serve the SPA and API on one origin with an
   `/api` prefix (needed for the Docker phase, and for `VITE_API_BASE_URL` at build time)?
   *Default assumption: yes, `/api` prefix works in production too.* Does not block design.
3. **`%` display** — Should a percent result still show the bare ratio (`0.5`) rather than
   `50%`? *Default: bare ratio, because the contract defines `percent(a) = a / 100`.*
4. **Visual palette** — Accent/neutral/primary hues are explicitly delegated ("mine to refine").
   No answer needed before design, but the four roles must remain distinguishable (AC-L6).

None of the above blocks planning; each has an explicit default that the plan will follow.

---

## 14. Expected file layout & traceability

### 14.1 File layout (canonical; extra splitting is allowed only if the contracts hold)

```
frontend/
├── package.json                 # scripts: dev, build (tsc -b && vite build), test (vitest run), lint
├── package-lock.json
├── index.html                   # lang="en", viewport meta, title
├── vite.config.ts               # react plugin, @ alias, server.proxy, Vitest test block
├── tsconfig.json                # references app/node
├── tsconfig.app.json            # strict, paths @/*
├── tsconfig.node.json
├── components.json              # shadcn config (aliases, css: src/index.css, rsc: false)
├── eslint.config.js
└── src/
    ├── main.tsx                 # createRoot + StrictMode + index.css
    ├── App.tsx                  # <main> shell + <Calculator />
    ├── index.css                # tailwind import + theme tokens
    ├── vite-env.d.ts            # /// <reference types="vite/client" />
    ├── components/
    │   ├── Calculator.tsx       # state machine (§5), key grid (§4), keyboard (§5.4)
    │   ├── Calculator.test.tsx  # T-1, T-2, T-3 (+ recommended extras)
    │   └── ui/button.tsx        # shadcn Button + 4 calculator variants
    ├── lib/
    │   ├── utils.ts             # cn (shadcn)
    │   ├── api.ts               # §6.1
    │   ├── api.test.ts          # T-4
    │   ├── validation.ts        # §6.2
    │   ├── validation.test.ts
    │   ├── format.ts            # §6.3
    │   └── format.test.ts
    └── test/
        └── setup.ts             # jest-dom + cleanup
```

### 14.2 Traceability

| Requirement area | Acceptance criteria |
|---|---|
| Scaffold, tooling, gates | AC-S1 … AC-S6 |
| Layout / responsiveness | AC-L1 … AC-L6 |
| Accessibility | AC-A1 … AC-A6 |
| State machine / behavior | AC-B1 … AC-B15 |
| REST mapping | AC-R1 … AC-R8 |
| Validation module | AC-V1 … AC-V5 |
| Formatting module | AC-F1 … AC-F6 |
| API client | AC-P1 … AC-P6 |
| Performance boundaries (§5.6) | AC-B1, AC-B14, AC-R5, AC-R6, AC-P4 |
| Tests | AC-T1 … AC-T6 |
| Invariants / non-goals | AC-N1 … AC-N4 |

### 14.3 Definition of done

1. `make frontend-install`, `make frontend-test`, `make frontend-lint`, `make frontend-build`
   succeed; `make check` succeeds end to end.
2. The four mandated scenarios (T-1 … T-4) pass and are traceable to AC-T1 … AC-T4.
3. With `go run ./cmd/server` running, the manual smoke path `12 × 4 =` → `48` works in the
   browser through the Vite proxy, and `5 ÷ 0 =` shows `division by zero`.
4. At a 320 px viewport the card fits with no horizontal scroll and all keys remain ≥ 44 × 44.
