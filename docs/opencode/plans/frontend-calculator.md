# Plan: Frontend Scaffold + Happy-Path Calculator (`frontend/`)

- **PRD (authoritative):** `docs/opencode/prds/frontend-calculator.md` — all decisions closed; do not re-derive or contradict.
- **Contract (single source of truth):** `.opencode/skills/api-contract/SKILL.md`
- **Backend (frozen):** `backend/internal/httpapi` + `backend/cmd/server` — verified `POST /evaluate`, `GET /health` on `:8080`, **no `/api` prefix** (`httpapi.go:44-49`).
- **Scope:** Frontend only. Create `frontend/` (does not exist today). No backend, `Makefile`, `.opencode/`, or api-contract changes. The only repo-hygiene edit is `.gitignore`.
- **Worktree:** `/Users/juancamilocortesmedina/workspace/sezzlecalc-worktrees/fe-scaffold` (isolated worktree, already active).

---

## 1. Context & Goals

### Context

The repo currently has a verified Go backend (pure `internal/calc` + thin `internal/httpapi` + `cmd/server` on `:8080`) and **no `frontend/` directory**. The root `Makefile` already declares frontend gates — `frontend-install` (`cd frontend && npm install`), `frontend-test` (`npm run test`), `frontend-lint` (`npm run lint`), `frontend-build` (`npm run build`) — and `make check` (`Makefile:15`) runs `frontend-test frontend-lint frontend-build`. Creating `frontend/` **activates** those gates: the scaffold must define all three npm scripts (or `make check` goes red — BR-1).

The REST contract (`.opencode/skills/api-contract/SKILL.md`, verified against `backend/internal/httpapi/httpapi.go`) is:

- `POST /evaluate` body `{ "operation": string, "a": number, "b": number }`; `a` required always; `b` required for binary (`add/subtract/multiply/divide/power`) and **omitted** for unary (`sqrt/percent`).
- Success `200 {"result": <number>}` (raw JSON number, no rounding). Error `4xx {"error":"<fixed-string>"}` with **no `result` key**.
- Error strings (rendered verbatim): `invalid input`, `division by zero`, `square root of negative number`, `invalid operation`, `non-finite result`, plus `method not allowed`/`internal error`.
- Backend routes are **plain paths** (`/evaluate`, `/health`); the Vite dev proxy must rewrite `/api/*` → `/*` (BR-3).

### Desired outcome

A Vite + React + TypeScript app that renders a 360px calculator card, delegates every computed value to `POST /api/evaluate` (proxied to `/evaluate`), performs **zero arithmetic client-side**, implements the fixed single-operation state machine (§5), and passes `make frontend-install|test|lint|build` and `make check`.

### Success statement (PRD §1.1)

`1 2 × 4 =` → display `48`, exactly one `POST /api/evaluate` with `{"operation":"multiply","a":12,"b":4}`. Backend stopped → UI still renders; a computed press shows `Could not reach the server`.

### Non-goals (explicit, PRD §2)

NG-1 no backend change; NG-2 no Docker/production serving; NG-3 no expression parser/precedence/parentheses/multi-operand chaining (one binary op at a time); NG-4 no memory/history/themes; NG-5 no persistence/auth/i18n/CI-CD/observability/rate-limiting; NG-6 no accessibility hardening beyond §4.4/§5; NG-7 no rewriting server error strings; NG-8 no digit cap/input masking/thousands separators; NG-9 keyboard maps only §5.4 keys (no shortcuts for `√ xʸ % ±`); NG-10 no README/docs rewrite; NG-11 jsdom tests only.

---

## 2. Approach

**Design summary.** Scaffold a stock Vite `react-ts` app (Vite 7 + React 19 + TypeScript `strict`), add Tailwind v4 via the `@tailwindcss/vite` plugin, and shadcn/ui with exactly one component (`Button`). Three pure modules (`src/lib/{validation,format,api}.ts`) hold every "smart" decision: `validation.ts` owns the binary/unary metadata + `parseEntry` guard; `format.ts` owns the single display rule `formatNumber`; `api.ts` owns the never-throwing request client. `Calculator.tsx` is a dumb-but-exact state machine (`useReducer`) that calls `parseEntry` to validate, `evaluate` to compute, and `formatNumber` to render — it never does arithmetic (AC-N1).

**State machine.** Implement with `useReducer` (component-local, D-15) over `CalculatorState` (§5.1) plus a `requestToken` ref for staleness. All synchronous transitions (digit/decimal/sign/clear/backspace/operator) are pure reducer cases; `=`/unary are fired from stable callbacks that read the latest state via a `stateRef`, validate, capture `const token = ++requestToken.current`, dispatch `begin`, await `evaluate`, and dispatch `resolve` only if the token still matches. `AC` and unmount both bump the token (invalidate in-flight). The `busy` status + disabled buttons guarantee exactly one request per evaluating press (D-2).

**Layout.** `App.tsx` renders the centered `<main>` shell; `Calculator.tsx` renders the `<section aria-label="Calculator">` card, the `<output>` display, and a single 4-col × 6-row CSS grid of 21 `<Button>`s in exact DOM order. Key roles are expressed as **four shadcn Button variants** (`digit`/`operator`/`equals`/`clear`), not class soup (D-12).

**Alternatives considered & rejected:**

- **React state library / context / hooks split** — rejected: single component + reducer is sufficient (D-15); no new abstraction.
- **Hand-rolled `<button>` instead of shadcn Button** — rejected: AC-S4 requires shadcn Button; variants keep roles typed and distinct (D-12).
- **Sending `b` on unary as `null`** — rejected: the backend 400s a numeric/`null` `b` on unary (`httpapi.go:153-162`); the `EvaluateRequest` union makes omitting `b` a type-level guarantee (AC-R4).
- **Calling `/health` on mount or prefetching** — rejected: zero requests on mount is a hard boundary (§5.6).
- **Debounce/throttle for "exactly one request"** — rejected: the `busy` status + disabled keys + token are the specified mechanism (D-2), not timing.
- **Rewriting server error strings** — rejected: render verbatim (NG-7, D-11).

### Dependency order (build bottom-up)

1. `.gitignore` edit (independent; do first or last, no deps).
2. `package.json` → `npm install` (creates `package-lock.json`, `node_modules`).
3. `tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json`.
4. `vite.config.ts`, `index.html`, `src/vite-env.d.ts`.
5. `eslint.config.js`, `components.json`, `src/index.css`.
6. `src/lib/utils.ts` (needed by `button.tsx`).
7. `src/lib/validation.ts` (types needed by `api.ts` and `Calculator.tsx`).
8. `src/lib/format.ts` (needed by `Calculator.tsx`).
9. `src/lib/api.ts` (imports `validation` types).
10. `src/components/ui/button.tsx` (imports `cn`; needs cva + radix-slot).
11. `src/main.tsx`, `src/App.tsx`.
12. `src/components/Calculator.tsx`.
13. `src/test/setup.ts`.
14. Tests: `src/lib/format.test.ts`, `src/lib/validation.test.ts`, `src/lib/api.test.ts`, `src/components/Calculator.test.tsx`.

Everything after step 2 can be type-checked incrementally with `npm run build` (which runs `tsc -b`) and `npm run lint`.

---

## 3. File-by-file changes

Canonical layout (PRD §14.1). New files unless marked **MODIFIED**.

| # | Path | New/Mod | Purpose |
|---|------|---------|---------|
| 1 | `.gitignore` | **MODIFIED** | Ignore `frontend/dist`, `.vite`, `*.tsbuildinfo` (BR-2). Only repo-hygiene edit allowed. |
| 2 | `frontend/package.json` | New | Scripts + pinned deps (see §3.2). |
| 3 | `frontend/package-lock.json` | New (generated) | Produced by `npm install`; commit it. |
| 4 | `frontend/index.html` | New | `lang="en"`, viewport meta, title, `#root`, module script. |
| 5 | `frontend/vite.config.ts` | New | React + Tailwind plugins, `@`→`./src` alias, dev proxy rewrite, Vitest block. |
| 6 | `frontend/tsconfig.json` | New | Solution file referencing app/node. |
| 7 | `frontend/tsconfig.app.json` | New | `strict`, `@/*` paths, `vitest/globals` types. |
| 8 | `frontend/tsconfig.node.json` | New | Node types for `vite.config.ts`. |
| 9 | `frontend/eslint.config.js` | New | Flat config; `eslint .` passes. |
| 10 | `frontend/components.json` | New | shadcn config (`rsc:false`, `css:src/index.css`). |
| 11 | `frontend/src/index.css` | New | Tailwind v4 import + theme tokens. |
| 12 | `frontend/src/vite-env.d.ts` | New | `vite/client` ref + `VITE_API_BASE_URL` typing. |
| 13 | `frontend/src/main.tsx` | New | `createRoot` + `StrictMode` + `index.css`. |
| 14 | `frontend/src/App.tsx` | New | `<main>` shell + `<Calculator />`. |
| 15 | `frontend/src/lib/utils.ts` | New | `cn` (clsx + tailwind-merge). |
| 16 | `frontend/src/lib/validation.ts` | New | Operation types/metadata + `parseEntry` (§6.2). |
| 17 | `frontend/src/lib/format.ts` | New | `formatNumber` (§6.3). |
| 18 | `frontend/src/lib/api.ts` | New | `evaluate` never-throws client (§6.1). |
| 19 | `frontend/src/components/ui/button.tsx` | New | shadcn Button + 4 calculator variants (§3.19). |
| 20 | `frontend/src/components/Calculator.tsx` | New | State machine, key grid, keyboard (§3.20). |
| 21 | `frontend/src/test/setup.ts` | New | jest-dom + cleanup + unstub globals. |
| 22 | `frontend/src/lib/format.test.ts` | New | §6.3 table (AC-F). |
| 23 | `frontend/src/lib/validation.test.ts` | New | `parseEntry` + metadata (AC-V). |
| 24 | `frontend/src/lib/api.test.ts` | New | T-4 status/transport table (AC-P). |
| 25 | `frontend/src/components/Calculator.test.tsx` | New | T-1/T-2/T-3 + recommended extras (AC-T). |

---

### 3.1 `.gitignore` (MODIFIED)

Append a frontend section. `node_modules` is already ignored (line 83). Add exactly:

```gitignore
### frontend ###
frontend/dist/
frontend/.vite/
frontend/*.tsbuildinfo
```

No `.env` file is committed (BR-2/AC-S6). Nothing else in `.gitignore` changes.

---

### 3.2 `frontend/package.json` (exact)

```json
{
  "name": "frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@radix-ui/react-slot": "^1.2.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.30.1",
    "@tailwindcss/vite": "^4.1.11",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^24.0.0",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.6.0",
    "eslint": "^9.30.1",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^16.2.0",
    "jsdom": "^26.1.0",
    "tailwindcss": "^4.1.11",
    "typescript": "~5.8.3",
    "typescript-eslint": "^8.35.0",
    "vite": "^7.1.0",
    "vitest": "^3.2.4"
  }
}
```

Contract notes (these are the gate constraints, PRD §9.4):

- `test` = `vitest run` (non-interactive; `make check` calls it).
- `lint` = `eslint .` (exactly; the flat config ignores `dist`).
- `build` = `tsc -b && vite build` (type-check + production build).
- `type: "module"` is required so `eslint.config.js` / `vite.config.ts` load as ESM.

**Version pinning note (assumption to confirm at install time):** these are known-compatible majors for a Vite 7 + React 19 + Tailwind v4 + Vitest 3 + ESLint 9 stack (verified via registry docs: Vite 7/Vitest 3 support `defineConfig` from `vitest/config`; shadcn/ui new projects default to Tailwind v4 + React 19 and generate `button.tsx` using `class-variance-authority` + `@radix-ui/react-slot` + `cn`). `npm install` resolves exact patch versions and writes them into `package-lock.json`, which becomes the pinned source of truth. **Flag:** confirm exact `@types/node` major against your Node version (Node 22/24 → `@types/node@^24`); if the lock resolution fails, run `npm install <pkg>@latest` per package — the behavioral ACs do not depend on specific patch numbers.

Runtime deps are the minimum required by shadcn Button + React. `lucide-react` is **not** needed (no icons) and `tw-animate-css` is **not** needed (no animated components); omit both.

---

### 3.3 `frontend/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Calculator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

### 3.4 `frontend/vite.config.ts`

```ts
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''), // REQUIRED — backend has no /api prefix (BR-3)
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    css: false,
  },
});
```

- `defineConfig` from `vitest/config` (per PRD §7/§9.1) so the `test` block is typed.
- `@` alias resolves via `node:url` (ESM-safe; no `__dirname`). Requires `@types/node`.
- The proxy `rewrite` is mandatory: `/api/evaluate` → `http://localhost:8080/evaluate` (BR-3). No CORS anywhere.

---

### 3.5 `frontend/tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

### 3.6 `frontend/tsconfig.app.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src"]
}
```

Key requirements:

- `strict: true` (AC-S3); no `@ts-ignore`/`@ts-expect-error` anywhere.
- `paths["@/*"]` mirrors the Vite alias (AC-S4).
- `types: ["vite/client", "vitest/globals"]` makes `import.meta.env` typed and `describe/it/expect/vi/beforeEach/afterEach` available globally in test files (which are under `src/` and compiled by `tsc -b`).
- `verbatimModuleSyntax: true` → all type-only imports MUST use `import type` (the lib modules already do).
- `noUncheckedSideEffectImports` is satisfied by the `vite/client` reference in `vite-env.d.ts` (declares `*.css`).
- `@testing-library/jest-dom/vitest` matcher types (`.toBeInTheDocument`, `.toHaveTextContent`, `.toBeDisabled`, `.toBeEnabled`) are pulled in by `src/test/setup.ts` importing `@testing-library/jest-dom/vitest`; since `setup.ts` is inside `include: ["src"]`, its `Assertion` augmentation is visible project-wide.

### 3.7 `frontend/tsconfig.node.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,

    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

`types: ["node"]` supplies `node:url`/`import.meta.url` types for `vite.config.ts`.

---

### 3.8 `frontend/eslint.config.js`

```js
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
);
```

- `eslint .` ignores `dist` (critical, or a prior build's JS would be linted) and auto-ignores `node_modules`.
- `files: ['**/*.{ts,tsx}']` means `eslint.config.js` itself and `.html`/`.css` are not linted.
- No type-aware linting (no `parserOptions.project`), so `eslint .` runs fast and never trips on project references.

---

### 3.9 `frontend/components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

`rsc: false` and `css: src/index.css` are the PRD-required fields (§14.1). `iconLibrary` is metadata only; no icons are used.

---

### 3.10 `frontend/src/index.css`

Tailwind v4 CSS (no `tailwind.config.js`; the `@tailwindcss/vite` plugin reads `@import "tailwindcss"`). Must define, at minimum, the semantic tokens the four calculator variants depend on: `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `card`, `card-foreground`, `background`, `foreground`, `border`, `ring`. Canonical shadcn "neutral" default (light + `.dark`):

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

If generated by `npx shadcn@latest init`, keep the CLI's exact token values (palette is "mine to refine", §4.1) — only the presence of the listed tokens is required (AC-L6).

---

### 3.11 `frontend/src/vite-env.d.ts`

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

---

### 3.12 `frontend/src/main.tsx`

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### 3.13 `frontend/src/App.tsx`

```tsx
import Calculator from './components/Calculator';

function App() {
  return (
    <main className="grid min-h-[100dvh] place-items-center p-4">
      <Calculator />
    </main>
  );
}

export default App;
```

---

### 3.14 `frontend/src/lib/utils.ts`

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

---

### 3.15 `frontend/src/lib/validation.ts` (exact, PRD §6.2)

```ts
export type BinaryOperation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power';
export type UnaryOperation = 'sqrt' | 'percent';
export type Operation = BinaryOperation | UnaryOperation;

export const BINARY_OPERATIONS: readonly BinaryOperation[] = [
  'add',
  'subtract',
  'multiply',
  'divide',
  'power',
];

export const UNARY_OPERATIONS: readonly UnaryOperation[] = ['sqrt', 'percent'];

export const ENTRY_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function isBinaryOperation(op: Operation): op is BinaryOperation {
  return (BINARY_OPERATIONS as readonly string[]).includes(op);
}

export function isUnaryOperation(op: Operation): op is UnaryOperation {
  return (UNARY_OPERATIONS as readonly string[]).includes(op);
}

export function parseEntry(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  if (!ENTRY_PATTERN.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
```

Notes: no `g`/`y` flag on `ENTRY_PATTERN` (so repeated `.test` has no `lastIndex` state). This module is the **only** source of binary-vs-unary truth (AC-V4).

### 3.16 `frontend/src/lib/format.ts` (exact, PRD §6.3)

```ts
export const MAX_SIGNIFICANT_DIGITS = 12;

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'Error';
  if (value === 0) return '0'; // covers -0 (JS: -0 === 0)

  let s = value.toPrecision(MAX_SIGNIFICANT_DIGITS);

  const eIndex = s.indexOf('e');
  const mantissa = eIndex === -1 ? s : s.slice(0, eIndex);
  const exponent = eIndex === -1 ? '' : s.slice(eIndex);

  let m = mantissa;
  if (m.includes('.')) {
    m = m.replace(/0+$/, '').replace(/\.$/, '');
  }

  return m + exponent;
}
```

Pinned table (must pass exactly, AC-F5): see §5.2. This rule relies on JS `toPrecision` switching to exponential at exponent ≥ 12 or < −6 (R-3).

### 3.17 `frontend/src/lib/api.ts` (exact, PRD §6.1)

```ts
import type { BinaryOperation, UnaryOperation } from './validation';

export type EvaluateRequest =
  | { operation: BinaryOperation; a: number; b: number }
  | { operation: UnaryOperation; a: number };

export type EvaluateOutcome =
  | { ok: true; value: number }
  | { ok: false; error: string };

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
```

Invariants (AC-P1..P6): never throws/rejects; no retry/cache/queue; reads `result` only on 2xx, `error` only on non-2xx; a 2xx without a finite numeric `result` → transport error; any thrown/rejected path (network, abort/timeout, DNS, CORS, bad JSON) → `TRANSPORT_ERROR`.

### 3.18 `frontend/src/components/ui/button.tsx` (shadcn Button + 4 variants)

Full working file (structure matches what `npx shadcn@latest add button` generates for Tailwind v4/React 19; if generated by CLI, keep the CLI's base/size/other-variant class strings and only add the four calculator variant keys):

```tsx
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

// NOTE (BR-5): the four calculator variants (digit/operator/equals/clear) are
// hand-added below. `npx shadcn@latest add button` REGENERATES this file and
// drops them — re-add after any regeneration.

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        // --- calculator variants (hand-added; see BR-5) ---
        digit: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        operator: 'bg-primary/10 text-primary hover:bg-primary/20',
        equals: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        clear: 'bg-muted text-muted-foreground hover:bg-muted/80',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
```

**How to add the variants without breaking shadcn's API:** add four string keys to the `variant` field of the `cva(...)` config. Because `VariantProps<typeof buttonVariants>["variant"]` is inferred from the config, `variant="digit" | "operator" | "equals" | "clear"` become valid `Button` props automatically — no signature change, no export change. Do **not** add new top-level variant groups or change `defaultVariants`. The role treatments (AC-L6, D-12) are `digit` neutral, `operator` primary-tinted, `equals` primary filled, `clear` muted. The exact hue/opacity values are refinable; the four roles must remain visually distinct.

**BR-5 caveat:** regeneration overwrites this file. Re-add the four keys afterward (the header comment documents this).

### 3.19 `frontend/src/components/Calculator.tsx`

Complete implementation (state machine, key grid, keyboard). Exact behavior below mirrors §5; the only refinable parts are the card radius/shadow/palette classes (§4.1 "mine to refine").

```tsx
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { evaluate, type EvaluateRequest } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { parseEntry, type BinaryOperation, type UnaryOperation } from '@/lib/validation';

type DisplayStatus = 'editing' | 'awaiting' | 'result' | 'error' | 'busy';

interface CalculatorState {
  entry: string;
  lhs: number | null;
  operator: BinaryOperation | null;
  status: DisplayStatus;
  error: string | null;
}

const INITIAL: CalculatorState = {
  entry: '0',
  lhs: null,
  operator: null,
  status: 'editing',
  error: null,
};

type Action =
  | { type: 'digit'; d: string }
  | { type: 'decimal' }
  | { type: 'sign' }
  | { type: 'clear' }
  | { type: 'backspace' }
  | { type: 'operator'; op: BinaryOperation }
  | { type: 'begin' }
  | { type: 'resolve'; outcome: EvaluateOutcome; preserve: boolean };

function reducer(state: CalculatorState, action: Action): CalculatorState {
  switch (action.type) {
    case 'digit': {
      const d = action.d;
      switch (state.status) {
        case 'busy':
          return state;
        case 'result':
        case 'error':
          // lhs/operator preserved: null after '=', preserved after a unary (B-1)
          return { ...state, entry: d, status: 'editing', error: null };
        case 'awaiting':
          return { ...state, entry: d, status: 'editing' };
        case 'editing':
          if (state.entry === '0' || state.entry === '') return { ...state, entry: d };
          return { ...state, entry: state.entry + d };
      }
      return state;
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
          if (state.entry.includes('.')) return state; // at most one decimal point
          return { ...state, entry: state.entry + '.' };
      }
      return state;
    }
    case 'sign': {
      if (state.status === 'busy' || state.status === 'error' || state.status === 'awaiting') {
        return state;
      }
      if (state.entry === '') return state;
      const v = parseEntry(state.entry);
      if (v === null || v === 0) return state; // never produce -0
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
        // second operand typed: replace the operator, never evaluate (B-6)
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

  // Latest state readable from stable callbacks (single keydown listener).
  const stateRef = useRef(state);
  stateRef.current = state;

  const evaluateCurrent = useCallback(
    (build: (s: CalculatorState) => EvaluateRequest | null, preserve: boolean) => {
      const s = stateRef.current;
      if (s.status === 'busy' || s.status === 'error') return; // B-7/B-8 guard
      const request = build(s);
      if (request === null) return; // unparsable entry → no request
      const token = ++requestToken.current;
      dispatch({ type: 'begin' });
      void evaluate(request).then((outcome) => {
        if (token !== requestToken.current) return; // stale → discard (B-4, unmount)
        dispatch({ type: 'resolve', outcome, preserve });
      });
    },
    [],
  );

  const pressEquals = useCallback(() => {
    evaluateCurrent((s) => {
      if (s.operator === null || s.lhs === null) return null; // B-7/B-9
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
        return { operation: op, a: v }; // no `b` key (AC-R4)
      }, true); // preserve lhs/operator (B-8/B-12)
    },
    [evaluateCurrent],
  );

  const clear = useCallback(() => {
    requestToken.current += 1; // invalidate in-flight (B-4)
    dispatch({ type: 'clear' });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // don't hijack Cmd+R etc.
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) {
        return; // native button activation wins (D-14)
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
          e.preventDefault(); // Firefox quick-find
          return;
        case 'Enter':
        case '=':
          pressEquals();
          return;
        case 'Backspace':
          dispatch({ type: 'backspace' });
          e.preventDefault(); // history navigation
          return;
        case 'Escape':
          clear();
          return;
        default:
          return; // incl. Tab — never preventDefault
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      requestToken.current += 1; // invalidate in-flight on unmount
    };
  }, [clear, pressEquals]);

  const isBusy = state.status === 'busy';
  const isError = state.status === 'error';
  const displayText = isError
    ? (state.error ?? 'Unknown error')
    : state.entry === '' ? '0' : state.entry;
  const displaySize = isError
    ? 'text-lg break-words'
    : displayText.length <= 10 ? 'text-4xl' : 'text-2xl';

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
      <output
        aria-live="polite"
        aria-label="Calculator display"
        data-testid="calculator-display"
        className={cn(
          'flex min-h-[96px] w-full items-end justify-end text-right tabular-nums',
          isError ? 'whitespace-normal' : 'whitespace-nowrap',
          displaySize,
        )}
      >
        {displayText}
      </output>

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
```

Implementation notes the coder must respect:

- **21 keys, exact order** (focus order = DOM order, AC-A6). Row 1 = `√`(span2) `xʸ`(span2); rows 2–5 = 4 keys; row 6 = `0`(span2) `.` `=`. There is **no Backspace button** (Backspace is keyboard-only, §5.4) — see Open Questions on the §4.3 `←` artifact.
- **Exact glyphs:** `√` U+221A, `xʸ` (x + U+02B8), `÷` U+00F7, `×` U+00D7, `−` U+2212 (minus, not hyphen), `±` U+00B1.
- **Every key `type="button"`** (AC-A1) and glyph keys carry the exact `aria-label` from §4.4; digits use text content. All 21 names unique.
- **Disabled while busy** except `AC` (`disabled={isBusy && k.label !== 'AC'}`); the reducer also ignores non-AC actions in `busy` (B-10) — defense in depth.
- **Sizing:** `aspect-square w-full h-auto` for single-cell keys, `col-span-2 w-full h-auto` for span keys. `h-auto` overrides the Button base `h-9` (tailwind-merge keeps the later class), so single keys are square (`aspect-square`) and span keys stretch to the row height. Verify ≥ 44×44 at 320px (AC-L3).
- **Display:** `displayText` precedence `error → (error ?? 'Unknown error')`, else `entry === '' ? '0' : entry`; size `text-4xl` ≤10 chars, else `text-2xl`; error `text-lg break-words` (2-line wrap). `tabular-nums` + `whitespace-nowrap` for numeric only.
- **`±` never changes status** (B-3): on a `result` it leaves `status='result'` so the next digit still replaces the entry.
- **`formatNumber` applied exactly once** per computed value (inside `resolve`), never on render (AC-F6).
- **Keyboard:** single listener registered once (stable deps), removed on unmount (which also bumps the token). `preventDefault` only on `/` and `Backspace`; `Tab` never prevented; `Enter`/`Space` on a focused button is ignored so native activation wins (D-14/AC-A3).

---

### 3.20 `frontend/src/test/setup.ts`

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
```

`vi.unstubAllGlobals()` reverts `vi.stubGlobal('fetch', …)` after every test; each test stubs `fetch` fresh. No real network can occur (§5.6).

---

## 4. Data, API & schema impact

- **No backend, `Makefile`, `.opencode/`, or `api-contract` changes** (NG-1, AC-S5). The backend (`POST /evaluate`, `GET /health` on `:8080`) is consumed as-is.
- **No migration/schema.** No persistence. New files are all static frontend source/config.
- **Config/env:**
  - `VITE_API_BASE_URL` (optional, **base prefix**, BR-4) defaults to `/api`; trailing slashes stripped in `api.ts`. No `.env` file committed (AC-S6). Setting it to `http://localhost:8080` would bypass the proxy and fail CORS — documented, not supported.
  - Vite dev proxy rewrites `/api/*` → `/*` to `http://localhost:8080` (BR-3). No CORS anywhere.
- **`.gitignore`** gains `frontend/dist/`, `frontend/.vite/`, `frontend/*.tsbuildinfo` (BR-2). `node_modules` already ignored.
- **Downstream consumers:** none beyond the repo gates. `make check` becomes the integration point; it runs `frontend-test`, `frontend-lint`, `frontend-build` (but **not** `frontend-install` — see §7).

---

## 5. Test strategy

Stack: Vitest + RTL + `@testing-library/user-event` + `@testing-library/jest-dom/vitest`, `environment: 'jsdom'`, `globals: true`, `restoreMocks: true`, `css: false` (already in `vite.config.ts`). `fetch` is always stubbed; async assertions use `findBy`/`waitFor`, never a bare assertion right after a request-triggering click.

All tests render `<Calculator />` directly (except the three pure-module suites). Queries are by role + accessible name, never by glyph text (PRD §4.4).

### 5.1 The four mandated scenarios (in `src/components/Calculator.test.tsx`)

Shared harness:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Calculator from './Calculator';

function jsonResponse(init: { ok: boolean; status: number; body: unknown }) {
  return { ok: init.ok, status: init.status, json: async () => init.body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

**T-1 — binary path sends exactly one request and renders the server value**

```tsx
it('T-1: binary path posts exactly one request and renders the server value', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 48 } }));
  const user = userEvent.setup();
  render(<Calculator />);

  await user.click(screen.getByRole('button', { name: '1' }));
  await user.click(screen.getByRole('button', { name: '2' }));
  await user.click(screen.getByRole('button', { name: 'multiply' }));
  await user.click(screen.getByRole('button', { name: '4' }));
  await user.click(screen.getByRole('button', { name: 'equals' }));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/evaluate');
  expect(init?.method).toBe('POST');
  expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  expect(JSON.parse(init?.body as string)).toEqual({ operation: 'multiply', a: 12, b: 4 });

  await waitFor(() =>
    expect(screen.getByTestId('calculator-display')).toHaveTextContent('48'),
  );
});
```

**T-2 — unary path posts `sqrt` without `b`**

```tsx
it('T-2: unary path posts sqrt without b', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 200, body: { result: 3 } }));
  const user = userEvent.setup();
  render(<Calculator />);

  await user.click(screen.getByRole('button', { name: '9' }));
  await user.click(screen.getByRole('button', { name: 'square root' }));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
  expect(body).toEqual({ operation: 'sqrt', a: 9 });
  expect('b' in body).toBe(false);

  await waitFor(() =>
    expect(screen.getByTestId('calculator-display')).toHaveTextContent('3'),
  );
});
```

**T-3 — invalid entry blocks the request (no fetch)**

```tsx
it('T-3: an empty entry blocks the request (no fetch)', async () => {
  const user = userEvent.setup();
  render(<Calculator />);

  await user.click(screen.getByRole('button', { name: '5' }));
  await user.keyboard('{Backspace}'); // entry becomes '' → display '0'
  expect(screen.getByTestId('calculator-display')).toHaveTextContent('0');

  await user.click(screen.getByRole('button', { name: 'square root' }));
  expect(fetchMock).toHaveBeenCalledTimes(0);
  expect(screen.getByTestId('calculator-display')).toHaveTextContent('0');
});

it('T-3b: equals with no pending operation issues no request', async () => {
  const user = userEvent.setup();
  render(<Calculator />);
  await user.click(screen.getByRole('button', { name: 'equals' }));
  expect(fetchMock).toHaveBeenCalledTimes(0);
});
```

The T-3 guard is backed by the `validation.test.ts` `parseEntry` cases for `''`, `'1e999'`, `'Infinity'` (all `null`).

**T-4 — api client status and transport handling** (in `src/lib/api.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluate, EVALUATE_URL, REQUEST_TIMEOUT_MS, TRANSPORT_ERROR } from './api';

function jsonResponse(init: { ok: boolean; status: number; body: unknown }) {
  return { ok: init.ok, status: init.status, json: async () => init.body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('evaluate', () => {
  it('constants', () => {
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

  it('network failure → TRANSPORT_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('abort (AbortError) → TRANSPORT_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('non-JSON 2xx → TRANSPORT_ERROR', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } } as Response);
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('non-JSON 500 → TRANSPORT_ERROR', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new SyntaxError('bad json'); } } as Response);
    await expect(evaluate({ operation: 'add', a: 1, b: 2 })).resolves.toEqual({ ok: false, error: TRANSPORT_ERROR });
  });

  it('200 without numeric result → TRANSPORT_ERROR', async () => {
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
```

Every case asserts the promise **resolves** (`.resolves`), proving never-throws (AC-P1). The true 10s timer path is intentionally **not** unit-tested with fake timers (PRD §5.6 "no timers are waited on for the mandated tests"); the `AbortError` rejection case covers the abort→transport branch.

### 5.2 Supporting unit tests

**`src/lib/format.test.ts`** — the §6.3 table exactly:

```ts
import { describe, expect, it } from 'vitest';
import { formatNumber, MAX_SIGNIFICANT_DIGITS } from './format';

const cases: Array<[number, string]> = [
  [48, '48'], [0, '0'], [-0, '0'], [0.5, '0.5'], [-2.5, '-2.5'],
  [100, '100'], [1 / 3, '0.333333333333'], [Math.PI, '3.14159265359'],
  [1e12, '1e+12'], [123456789012, '123456789012'], [1e21, '1e+21'],
  [1e-7, '1e-7'], [1.5e-9, '1.5e-9'], [1e-6, '0.000001'],
  [Infinity, 'Error'], [NaN, 'Error'],
];

describe('formatNumber', () => {
  it.each(cases)('formats %p as %s', (input, expected) => {
    expect(formatNumber(input)).toBe(expected);
  });
  it('MAX_SIGNIFICANT_DIGITS is 12', () => {
    expect(MAX_SIGNIFICANT_DIGITS).toBe(12);
  });
});
```

**`src/lib/validation.test.ts`** — `parseEntry` accept/reject + metadata:

```ts
import { describe, expect, it } from 'vitest';
import {
  BINARY_OPERATIONS, UNARY_OPERATIONS,
  isBinaryOperation, isUnaryOperation, parseEntry,
} from './validation';

describe('parseEntry', () => {
  it.each(['12', '-5', '3.', '0.', '.5', '1e+21', '1.5e-9', '-0'])('accepts %s', (s) => {
    expect(parseEntry(s)).not.toBeNull();
  });
  it.each(['', ' ', '-', '.', '-.', 'abc', '0x10', '1,000', 'Infinity', 'NaN', '1e999', ' 12 34'])('rejects %s', (s) => {
    expect(parseEntry(s)).toBeNull();
  });
  it('parses representative values', () => {
    expect(parseEntry('12')).toBe(12);
    expect(parseEntry('-5')).toBe(-5);
    expect(parseEntry('.5')).toBe(0.5);
    expect(parseEntry('3.')).toBe(3);
  });
});

describe('operation metadata', () => {
  it('BINARY_OPERATIONS are exactly the five', () => {
    expect(BINARY_OPERATIONS).toEqual(['add', 'subtract', 'multiply', 'divide', 'power']);
  });
  it('UNARY_OPERATIONS are exactly the two', () => {
    expect(UNARY_OPERATIONS).toEqual(['sqrt', 'percent']);
  });
  it('isBinaryOperation true for the five, false for unary', () => {
    for (const op of BINARY_OPERATIONS) expect(isBinaryOperation(op)).toBe(true);
    for (const op of UNARY_OPERATIONS) expect(isBinaryOperation(op)).toBe(false);
  });
  it('isUnaryOperation true for the two, false for binary', () => {
    for (const op of UNARY_OPERATIONS) expect(isUnaryOperation(op)).toBe(true);
    for (const op of BINARY_OPERATIONS) expect(isUnaryOperation(op)).toBe(false);
  });
});
```

**Recommended extra component tests** (PRD §9.3, in `Calculator.test.tsx`):

1. **`±`** — click `7` → `±` → display `-7`, `fetchMock` 0 calls; `±` on `0` is a no-op.
2. **`AC` after error** — stub 422 `division by zero`; `5 ÷ 0 =` → display `division by zero`; click `clear` → display `0`.
3. **422 rendered verbatim** — `5 ÷ 0 =` → display `division by zero` (exact string, no prefix/suffix).
4. **busy disables keys** — `fetchMock.mockReturnValueOnce(new Promise(() => {}))` (never resolves); `9` → `square root`; assert `7` is `toBeDisabled()`, `clear` is `toBeEnabled()`, card has `aria-busy="true"`; then click `clear` to reset.
5. **operator replacement** — `1 2 + 4 × =` → one request `{operation:'multiply', a:12, b:4}`, display `48`.

### 5.3 Traceability (AC → step → test)

| AC | Plan step (file) | Covered by test |
|----|------------------|-----------------|
| AC-S1 | §3.2 scripts | `make frontend-*` gates |
| AC-S2 | §7 checklist | `make check` |
| AC-S3 | §3.6 strict, no ts-ignore | `tsc -b` passes |
| AC-S4 | §3.9/3.14/3.18 components.json + `cn` + Button | build + T-1 |
| AC-S5 | no backend/Makefile/.opencode edits | — (scope) |
| AC-S6 | §3.1 `.gitignore` | — (inspection) |
| AC-L1–L6 | §3.13/3.19 layout, grid, variants | manual 320px check (§7) |
| AC-A1–A6 | §3.19 buttons/aria/output/disabled/focus/keyboard | T-1..T-3 + busy test |
| AC-B1 | §3.19 `INITIAL`, no mount fetch | T-1 asserts `toHaveBeenCalledTimes(1)` only after clicks |
| AC-B2 | reducer digit/decimal | T-1 (append), unit cases |
| AC-B3 | reducer `clear` + token bump | AC-after-error test |
| AC-B4 | reducer `sign` | `±` test |
| AC-B5 | reducer `backspace` | T-3 |
| AC-B6 | reducer `operator` | T-1 (no fetch on `×`) |
| AC-B7 | reducer operator-replace | operator-replacement test |
| AC-B8 | `pressEquals` | T-1 exact body |
| AC-B9 | `pressEquals` guard | T-3b |
| AC-B10 | `resolve` binary | T-1 display `48` |
| AC-B11 | `pressUnary` | T-2 |
| AC-B12 | `resolve preserve` | — (covered by §3.19 `preserve` path; add optional test if desired) |
| AC-B13 | `resolve` error branch | 422-verbatim test |
| AC-B14 | `begin` + `disabled` | busy test |
| AC-B15 | token check + unmount bump | §3.19 (unit-reasoned; optional stale test) |
| AC-R1–R8 | §3.17 `EVALUATE_URL`, §3.19 request builders | T-1/T-2/api.test |
| AC-V1–V5 | §3.15 `parseEntry` | validation.test |
| AC-F1–F6 | §3.16 `formatNumber` | format.test |
| AC-P1–P6 | §3.17 `evaluate` | api.test (T-4) |
| AC-T1–T4 | §5.1 | Calculator.test.tsx + api.test.ts |
| AC-T5 | `vitest run`, no rejections/act warnings | `npm run test` |
| AC-T6 | `eslint .` + `tsc -b && vite build` | `npm run lint`/`build` |
| AC-N1 | no arithmetic in `src/` (only `entry + d` concat) | — (review; §3.19) |
| AC-N2–N4 | scope | — |

---

## 6. Risks & edge cases

### Decisions & risks carried forward (do not silently diverge)

- **D-1** `/api` prefix: proxy rewrites `/api/*`→`/*`; backend has no prefix.
- **D-2** exactly-one-request: single in-flight `busy` token + disabled keys; no debounce.
- **D-3/D-4** invalid-entry path: Backspace empties `entry` (`''`); display falls back to `0`; `entry` stays `''` so `parseEntry` guard is real.
- **D-5** `±` text-only sign toggle; no request; no-op on zero/empty/awaiting/error; never changes status.
- **D-6** precision: computed values enter `entry` pre-formatted (12 sig digits); chained ops use displayed value (`1÷3= × 3 =` → `0.999999999999`). Accepted.
- **D-7** operator press with a typed second operand **replaces** the operator, never evaluates (`12 + 4 × =` → `48`).
- **D-8** unary with pending binary op applies to the current entry and its result is the next `b`; `lhs`/`operator` preserved (`9 + 3 √ =`).
- **D-9** `=` with no second operand typed: `b = parseEntry(entry)` = `lhs` (`12 × =` → `144`).
- **D-10** rendering: `toPrecision(12)` + trailing-zero strip; scientific via JS thresholds (e ≥ 12, e < −6); `-0`→`0`.
- **D-11** errors verbatim; only client-authored string is `Could not reach the server`.
- **D-12** four added shadcn variants; `±` is `digit`, `√`/`%` are `operator`.
- **D-13** scientific strip in the same 4-col grid; `√` and `xʸ` span 2 cols each.
- **D-14** keyboard `Enter` means `=` unless a keypad button is the target (native activation wins).
- **D-15** component-local reducer; no state library/context.

### Risks (BR-*)

- **BR-1 (breaking for `make check`)** — creating `frontend/` activates `frontend-test/lint/build`. The scaffold **must** define `test`/`lint`/`build` and have `node_modules` installed. Mitigation: run `make frontend-install` before `make check` (§7).
- **BR-2 (repo hygiene)** — `frontend/dist` was not ignored. Added `dist/`, `.vite/`, `*.tsbuildinfo`.
- **BR-3 (dev-only breaking)** — proxy `rewrite` is mandatory; without it `/api/evaluate` → backend 404. Hard-coded in `vite.config.ts`, not env-configurable.
- **BR-4 (irreversible-ish)** — `VITE_API_BASE_URL` is a **base prefix**, never an endpoint URL. Deployment must preserve `/api` semantics.
- **BR-5 (generated-code coupling)** — `button.tsx` variants are lost on shadcn regeneration; documented in the file header; re-add after regeneration.
- **R-1** precision loss on chains (D-6) accepted.
- **R-2** async test flakiness: always `await` request-driven assertions (`waitFor`/`findBy`), never a bare post-click `expect`.
- **R-3** `toPrecision` boundary drift pinned by the §6.3 table.
- **R-4** if `npx shadcn` CLI is unavailable, hand-author `button.tsx` + `cn` + `components.json` (this plan gives exact contents); ACs are behavioral, not CLI-based.
- **R-5** backend absent in dev → computed keys show `Could not reach the server` (expected; covered by T-4).
- **R-6** 1 KiB backend request cap: bodies are tiny; no action.

### Concurrency / staleness / failure modes

- **≤1 in-flight**: `busy` status + disabled keys. The reducer's `busy` guard + disabled buttons cover realistic (separate-event) double presses. `AC`/unmount bump `requestToken`, so a late response is discarded (AC-B15). `evaluate` never rejects, so `.then` has no unhandled rejection path (AC-T5).
- **StrictMode double-invoke** (dev): the keydown effect's cleanup/register runs twice; both cleanup paths bump the token — harmless because there is no in-flight request at mount, and no request fires on mount.
- **Timeout**: `AbortController` + `setTimeout(10s)`; timer cleared in `finally`; abort → `TRANSPORT_ERROR`.
- **Security**: no XSS surface — display text is the user's own entry or a server string rendered as React text (never `dangerouslySetInnerHTML`); no eval; no credentials/CORS.
- **Silent-failure risk**: none by design — every non-`ok` path surfaces a message; `formatNumber`'s `'Error'` branch is defensive-only (contract guarantees finite results).

---

## 7. Rollout & rollback

### Sequencing

1. Edit `.gitignore` (frontend section).
2. Add all `frontend/` files (steps 2–14 in §3).
3. `make frontend-install` (creates `package-lock.json` + `node_modules`). **Required before `make check`** because `check` does not run `frontend-install` (`Makefile:15`).
4. `npm run test` → all suites green, non-interactive.
5. `npm run lint` → `eslint .` clean.
6. `npm run build` → `tsc -b && vite build` clean; verify `frontend/dist/` is produced and git-ignored.
7. `make frontend-install frontend-test frontend-lint frontend-build` (idempotent) then `make check`.
8. Manual smoke (with `cd backend && go run ./cmd/server` and `npm run dev`): `1 2 × 4 =` → `48` via proxy (one `POST /api/evaluate`); `5 ÷ 0 =` → `division by zero`; stop backend → computed press shows `Could not reach the server`.
9. Visual check at 320px viewport: no horizontal scroll; non-spanning keys ≥ 44×44 and square; four roles distinguishable.

### Verification checklist (step → AC)

| # | Check | Command / observation | ACs |
|---|-------|----------------------|-----|
| 1 | Frontend dir + scripts exist | inspect `package.json` | AC-S1 |
| 2 | Install succeeds | `make frontend-install` | AC-S2 |
| 3 | Tests pass (non-interactive) | `make frontend-test` | AC-T1..T5 |
| 4 | Lint passes | `make frontend-lint` | AC-T6 |
| 5 | Build passes (type-check) | `make frontend-build` | AC-S3, AC-T6 |
| 6 | Full gate green | `make check` | AC-S2 |
| 7 | No forbidden edits | `git status` limited to `frontend/` + `.gitignore` | AC-S5 |
| 8 | Build output ignored | `git check-ignore frontend/dist` | AC-S6 |
| 9 | 21 buttons, correct names/order | render + `getByRole` | AC-A1, AC-L2, AC-L5 |
| 10 | No horizontal scroll @320px, keys ≥44px | DevTools 320px | AC-L1, AC-L3, AC-L4 |
| 11 | Proxy rewrite active | `1 2 × 4 =` → `48` | D-1, AC-R1, AC-B8 |
| 12 | No arithmetic in `src/` | grep for `+ - * /` arithmetic on parsed operands (only `entry + d` string concat) | AC-N1 |

### Rollback

- The feature is entirely additive (new `frontend/` tree + one `.gitignore` block). Revert = `git checkout .gitignore` and remove `frontend/` (or revert the introducing commit). No migration, no backend state, no shared config affected. `make check` reverts to backend-only gates automatically once `frontend/` is gone.

---

## 8. Open questions

All are non-blocking with decided defaults (PRD §13); the plan follows the defaults. Only one **PRD-internal ambiguity** needs confirmation before coding:

1. **§4.3 grid table `←` artifact.** The §4.3 table shows `←` in row 1 columns 2/4, but §4.1 says **21 keys**, §4.4 lists exactly 21 keys (no Backspace), and §5.4 makes Backspace keyboard-only. **Resolution adopted:** no Backspace button; row 1 = `√`(span2) + `xʸ`(span2). Confirm with the TPM if a visible Backspace key was actually intended — if so, the grid and 21-key count in §4.1 would need a PRD change (do not implement without one).

2. **D-6 precision trade-off** — losing sub-display precision on chained calculations is accepted (default). No exact-value field.

3. **Deployment base path** — assumes production serves SPA + API on one origin with `/api` prefix (needed for Docker phase; `VITE_API_BASE_URL` at build time). Default: yes.

4. **`%` display** — bare ratio (`0.5`), not `50%` (default, contract defines `percent(a)=a/100`).

5. **Visual palette** — accent/neutral/primary hues are "mine to refine"; only the four-role distinctness (AC-L6) is required.

6. **Exact dependency patch versions** — the `^` ranges in §3.2 are sensible, mutually-compatible majors; exact pins land in `package-lock.json` at `npm install`. Confirm `@types/node` major against the local Node version if resolution warns.
