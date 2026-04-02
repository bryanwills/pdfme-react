# REVIEW

This file tracks unresolved review feedback from prior review notes.
Addressed items are intentionally omitted.
All items from `CODEX-REVIEW.md` have been addressed.

## High Priority

1. `packages/ui/src/class.ts`
   `flushSync` in `mount()` still forces synchronous rendering. Remove it if unnecessary, or document the concrete reason it must stay.

2. `packages/schemas/src/multiVariableText/variables.ts`
   The manual parser changed behavior from the previous regex-based implementation. Add explicit edge-case coverage for nested braces such as `{a{b}`, and consider replacing the sparse `Array<string | undefined>` return shape with a `Map<number, string>`.

3. `packages/schemas/src/graphics/signature.ts`
   `fromDataURL` failures are still only logged. Corrupted persisted signature data should produce clearer user-facing feedback than a silent blank pad.

## Medium Priority

4. `packages/cli/src/diagnostics.ts`
   The module is still very large and should be split by diagnostic area to improve maintainability.

5. `packages/cli/src/fonts.ts`
   CJK font fetching still relies on a hardcoded GitHub raw URL. Consider a more stable source or configuration point.

6. `packages/ui/src/components/Renderer.tsx`
   `useRenderKey` still uses `JSON.stringify` over large render inputs. Revisit this if render cost or churn becomes measurable.

7. `package.json`
   The root build script still relies on shell background jobs with `&` and `wait`, which makes failure handling less robust than a dedicated parallel task runner.

8. `packages/schemas/src/builtins.ts`
   The reduced built-in plugin surface still needs confirmation and documentation if intentional, because it is a breaking change.

## Low Priority

9. `PLAN.md`
   The document is still in Japanese while the rest of the repository is primarily English.

10. `AGENTS.md`
    The file still serves only as a pointer to `CLAUDE.md`, which may not justify the extra indirection.

11. `packages/schemas/src/date/helper.ts`
    `normalizeAdLocale` still deserves an inline comment explaining the ESM/CJS interop issue it works around.

12. `packages/common/src/expression.ts`
    Formatting-only changes should ideally stay separated from logic changes in future commits to keep reviews easier.
