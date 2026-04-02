The patch introduces multiple user-facing regressions in the UI and CLI. Those issues would break expected behavior for consumers who pass initial UI options or use multi-page example templates.

Full review comments:

- [P2] Don't resync Designer zoom/sidebar from stale options on every change — /Users/kyoheifukuda/Develop/pdfme/packages/ui/src/components/Designer/index.tsx:96-103
  Adding `zoomLevel` and `sidebarOpen` to this effect turns `options.zoomLevel`/`options.sidebarOpen` into hard-controlled values. If a consumer passes an initial option and then uses the built-in toolbar to zoom or toggle the sidebar, the local state update immediately retriggers this effect and snaps the UI back to the original prop value, so those controls stop working unless the parent also updates `options`.

- [P2] Don't resync Preview zoom from stale options on every change — /Users/kyoheifukuda/Develop/pdfme/packages/ui/src/components/Preview.tsx:116-120
  This has the same regression for `Preview`/`Form`/`Viewer`: when the caller provides `options.zoomLevel`, any toolbar-driven `setZoomLevel` change immediately reruns this effect and restores the old prop value. That makes the built-in zoom controls unusable for consumers that only intended to set the initial zoom level.

- [P2] Populate sample inputs from every example page — /Users/kyoheifukuda/Develop/pdfme/packages/cli/src/commands/examples.ts:34-42
  `examples --withInputs` currently only inspects `schemas[0]`, so any multi-page official example produces an incomplete job file. For example, `new-sale-quotation` and `z-fold-brochure` both have editable fields on later pages, but the emitted sample input only covers page 1, leaving later-page fields blank and making the generated job misleading as a starting point.
