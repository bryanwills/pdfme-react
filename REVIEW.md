# REVIEW

This file tracks unresolved review feedback from prior review notes.

## Medium Priority

1. `packages/cli/src/diagnostics.ts`
   The module is still very large and should be split by diagnostic area to improve maintainability.

2. `packages/cli/src/fonts.ts`
   CJK font fetching still relies on a hardcoded GitHub raw URL. Consider a more stable source or configuration point.

3. `packages/ui/src/components/Renderer.tsx`
   `useRenderKey` still uses `JSON.stringify` over large render inputs. Revisit this if render cost or churn becomes measurable.

4. `package.json`
   The root build script still relies on shell background jobs with `&` and `wait`, which makes failure handling less robust than a dedicated parallel task runner.
