---
name: Python scraper path from dist
description: Correct path to Python utility scripts when called from esbuild-compiled handlers in dist/
---

# Python Scraper Path Convention

## The Rule
In handler files under `src/bot/handlers/`, always use:
```ts
const SCRIPT_DIR = path.resolve(__dirname, "../src/bot/utils");
```

**Why:** esbuild bundles everything into `dist/index.mjs`. At runtime, `__dirname` is `artifacts/api-server/dist/`. So `../src/bot/utils` resolves correctly to `artifacts/api-server/src/bot/utils/`.

Using `../../../src/bot/utils` is WRONG — it walks up 3 levels past the project root.

**How to apply:** Whenever adding a new Python utility script in `src/bot/utils/`, the TypeScript handler that spawns it must use `path.resolve(__dirname, "../src/bot/utils/<script>.py")`.

## Verification
```js
// node -e from dist/ to verify:
path.resolve('/path/to/dist', '../src/bot/utils')
// => /path/to/src/bot/utils ✓
```
