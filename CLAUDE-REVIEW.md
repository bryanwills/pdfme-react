# Code Review: PR #1399 — [WIP] Next Major Version Upgrade

**430 files changed**, +27,072 / -26,424

## Overview

This is a massive foundation PR preparing the next major version. The core changes are:

1. **Build system migration**: Jest → Vitest, Webpack/tsc → Vite, Prettier/ESLint → Oxlint/Oxfmt (`vp`)
2. **ESM-only distribution**: CJS support dropped across all packages
3. **New `@pdfme/cli` package**: Commands for `generate`, `validate`, `pdf2img`, `pdf2size`, `examples`, `doctor`
4. **React 18 migration**: `ReactDOM.render` → `createRoot` API
5. **Security hardening**: SVG sanitization in `createSvgStr`, CodeQL fixes
6. **New signature plugin**: `packages/schemas/src/graphics/signature.ts`
7. **Improved async handling**: Race condition fixes in UI hooks and Renderer

---

## Positive Changes

- **React 18 migration in `class.ts`** — Properly migrates from deprecated `ReactDOM.unmountComponentAtNode` to `createRoot` with a stored `Root` instance. The `mount()` method with `??=` is clean.

- **Renderer.tsx race condition fix** — The `cancelled` flag + `dataset.pdfmeRenderReady` pattern correctly prevents stale async renders from updating unmounted or re-rendered elements. Good improvement over the previous version.

- **`useUIPreProcessor` request ID pattern** — The `requestIdRef` counter to discard stale async results is a solid fix for the race condition where slow PDFs could overwrite faster subsequent results.

- **SVG sanitization in `createSvgStr`** — The allowlist approach with `safeTagNames`, `safeAttributeNames`, and proper HTML escaping is a strong security improvement. Previously, icon data could inject arbitrary attributes.

- **Variable parsing extraction** — Moving `getVariableIndices` and `countUniqueVariableNames` from inline regex in `uiRender.ts` to a dedicated `variables.ts` module with a visitor pattern is cleaner and more testable.

- **Date format safety** — `getSafeFormat` / `isValidDateFormat` properly handle `undefined`, `"undefined"`, and invalid formats instead of passing them directly to `date-fns`.

- **JSON parse hardening in `formUiRender`** — The try/catch around `JSON.parse(value)` with type validation prevents crashes on malformed input.

- **Type improvement** — `Plugin<any>` → `Plugin` in the `Plugins` type eliminates an `any` leak.

---

## Issues and Concerns

### High Priority

1. **`flushSync` in `mount()`** (`packages/ui/src/class.ts:143`)

   ```ts
   flushSync(() => {
     this.reactRoot!.render(node);
   });
   ```

   `flushSync` forces synchronous re-rendering, bypassing React's batching. This is generally discouraged — it can cause performance issues and trigger "cannot update during render" warnings if called from within a React lifecycle. Is there a specific reason this can't be a normal `render()` call? If so, document it.

2. **Sequential pdf processing is a performance regression** (`packages/ui/src/hooks.ts`)

   The old code ran `pdf2size` and `pdf2img` in parallel:
   ```ts
   const [_pages, imgBuffers] = await Promise.all([
     pdf2size(pdfArrayBuffer),
     pdf2img(pdfArrayBuffer.slice(), { scale: maxZoom }),
   ]);
   ```

   The new code runs them sequentially:
   ```ts
   const _pages = await pdf2size(createPdfArrayBuffer());
   const imgBuffers = await pdf2img(createPdfArrayBuffer(), { scale: maxZoom });
   ```

   The comment says "avoid pdf.js worker races and buffer detachment" — if that's the real issue, creating separate buffers (which you already do with `createPdfArrayBuffer()`) should be sufficient. Consider `Promise.all` with separate buffers.

3. **Variable parsing behavior change** (`packages/schemas/src/multiVariableText/variables.ts`)

   The old regex `/{([^}]+)}/g` and the new manual parser differ on nested braces. For input `{a{b}`, the old regex finds `{b}`, while the new parser also finds `{b}` but via a different mechanism (resetting `startIndex` on each `{`). This is fine for simple cases but the behavioral equivalence should be tested explicitly. Also, `getVariableIndices` returns a sparse array — `Array<string | undefined>` — which is unusual and could be replaced with a `Map<number, string>`.

4. **Signature plugin lacks cleanup** (`packages/schemas/src/graphics/signature.ts`)

   The `SignaturePad` and its event listeners are never cleaned up. The plugin's `ui` function creates a canvas, attaches `endStroke` and `click` listeners, but since pdfme re-renders by clearing `innerHTML`, the `SignaturePad` instance and listeners will leak. Consider returning a cleanup function or using `AbortController`.

5. **Signature plugin error handling** (`packages/schemas/src/graphics/signature.ts:38`)

   ```ts
   } catch (error) {
     console.error(error);
   }
   ```

   Silently swallowing the error on `fromDataURL` means corrupted saved data will show a blank pad with no user feedback. Consider showing a visual indicator.

### Medium Priority

6. **CLI `diagnostics.ts` is 1,242 lines** — This file is very large for a single module. Consider splitting it by diagnostic category (runtime, font, network, etc.).

7. **CLI `fonts.ts` fetches from hardcoded GitHub URL** (`packages/cli/src/fonts.ts:10`)

   ```ts
   const NOTO_SANS_JP_URL =
     'https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf';
   ```

   This is fragile — the GitHub `raw` URL format and branch name could change. Consider using a Google Fonts API URL or making the URL configurable.

8. **`useRenderKey` JSON.stringify for comparison** (`packages/ui/src/components/Renderer.tsx:57`)

   ```ts
   return JSON.stringify([value, mode, scale, schema, optionStr]);
   ```

   `JSON.stringify` on every render for comparison is a code smell. The `schema` object could be large for tables. The previous approach (returning an array as deps) was more React-idiomatic. If the goal was to reduce unnecessary re-renders when the schema object is structurally equal but referentially different, consider `useMemo` with deep comparison on the schema specifically.

9. **Root build script uses `&` and `wait`** (`package.json`)

   ```
   (npm run build -w packages/generator & npm run build -w packages/ui & npm run build -w packages/manipulator & wait)
   ```

   This relies on shell `&` for parallelism, which doesn't handle errors well (a failed background job won't fail the overall command in all shells). The old `run-p` from `npm-run-all2` was more robust. Consider using `concurrently` or `npm-run-all2`.

10. **`builtins.ts` is oddly minimal** (`packages/schemas/src/builtins.ts`)

    ```ts
    const builtInPlugins = { Text: text };
    ```

    Only `Text` is a built-in now? The previous `builtInPlugins` likely included more. Is this intentional? If so, it's a significant breaking change that needs documentation.

### Low Priority

11. **`PLAN.md` is in Japanese** — While the author is Japanese, the rest of the codebase (comments, docs, commit messages) is in English. Mixing languages may confuse contributors. Consider translating or keeping it as a separate internal doc.

12. **`AGENTS.md` is just a pointer** — `AGENTS.md` contains only `CLAUDE.md`. If it's just an alias, this indirection adds no value.

13. **`normalizeAdLocale` handles ESM default export issue** (`packages/schemas/src/date/helper.ts`) — Good fix, but add a comment explaining why this normalization is needed (ESM interop with CJS-authored locale packages).

14. **Formatting-only changes in `expression.ts`** — The entire patch for `expression.ts` is just whitespace reformatting from the new formatter. Consider separating formatting commits from logic changes for easier review.

---

## Summary

This is solid foundational work for a major version upgrade. The ESM migration, Vite build system, and React 18 upgrades are well-executed. The security improvements (SVG sanitization, expression hardening) are valuable.

**Key recommendations before merging:**
- Reconsider `flushSync` usage — document the necessity or remove it
- Restore parallel `pdf2size`/`pdf2img` with separate buffers
- Add cleanup logic to the signature plugin
- Consider splitting this into smaller PRs (build system, CLI, UI improvements, new plugins) for reviewability
- Ensure the `builtInPlugins` reduction is intentional and documented as a breaking change
