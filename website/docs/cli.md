# CLI

`@pdfme/cli` is the command-line surface for JSON-first pdfme workflows.

It is designed for:

- local template iteration without writing a custom Node script
- CI checks before running `generate`
- agentic workflows that need machine-readable output
- `basePdf` overlay work, where you place fields on top of an existing PDF

## Installation

Node.js 20 or later is required.

```bash
npm install -D @pdfme/cli
```

You can also run it directly with `npx`:

```bash
npx @pdfme/cli generate --help
```

## Main Commands

- `pdfme generate`
  - generate a PDF from a template + inputs or a unified job file
  - optionally render page images with `--image`
  - optionally overlay a grid and schema bounds with `--grid`
- `pdfme validate`
  - validate a template or unified job before generation
  - use `--json` for machine-readable inspection output
- `pdfme doctor`
  - diagnose runtime, font, `basePdf`, cache, and output-path issues before generation
- `pdfme pdf2img`
  - convert an existing PDF into page images
  - use `--verbose` to print source/output/render settings to stderr without polluting JSON stdout
- `pdfme pdf2size`
  - inspect page sizes in millimeters
  - use `--verbose` to print source/total-page information to stderr
- `pdfme examples`
  - export official example assets, optionally as a unified job with sample inputs

## Typical Workflow

Start from an official example, inspect the runtime assumptions, then generate images for visual review:

```bash
pdfme examples invoice --withInputs -o job.json
pdfme doctor job.json --json
pdfme generate job.json -o out.pdf --image --grid
```

This is especially useful for agentic or CI workflows because the CLI can return structured JSON instead of human-only output.

## Existing PDF Overlay Workflow

If you already have a PDF and want to place text, dates, signatures, or other fields on top of it:

```bash
pdfme pdf2img invoice.pdf --grid --gridSize 10
pdfme pdf2size invoice.pdf --json
pdfme doctor template.json -o out.pdf --image --json
pdfme generate -t template.json -i inputs.json -o out.pdf --image --grid
```

In this flow, your template uses the existing PDF as `basePdf`, and pdfme renders only the overlay fields.

## Machine-Readable Contract

When you pass `--json`:

- stdout is JSON only
- failures return `ok: false` with a structured error
- `doctor` returns `ok: true` when the command ran successfully, and uses `healthy` to report whether blocking issues were found
- `validate --json` and `doctor --json` return field-level `inputHints`, so automation can tell whether a field expects a plain string or a JSON string object

This makes the CLI suitable for automation, agents, and CI gates.

For example, `multiVariableText` fields expose expected variable names and a sample JSON string payload in `inputHints`.

## Font Contract

The CLI treats fonts as a source contract rather than a filename convention.

Supported inputs:

- local `.ttf` paths via `--font`
- local `.ttf` paths in unified job `options.font`
- public direct `http(s)` font asset URLs
- `.ttf` data URIs
- inline bytes from programmatic use

Current policy:

- direct `fonts.gstatic.com/...ttf` URLs are supported remote sources
- `fonts.googleapis.com/css*` stylesheet URLs are not supported
- unsafe/private/loopback font URLs are rejected
- `.otf` and `.ttc` are currently outside the supported contract

For CJK content, the CLI can automatically resolve and cache `NotoSansJP` unless you disable it with `--noAutoFont`.

## Remote Font Runtime Safety

Explicit remote fonts are resolved by the CLI before calling the generator.

- timeout: 15 seconds
- size limit: 32 MiB
- network/HTTP/timeout/size-limit failures are returned as `EFONT`

`pdfme doctor fonts ... --json` includes `needsNetwork` in each font source diagnosis so you can tell in advance whether the current job depends on network access.

## More Details

For the full command reference, examples, and current implementation notes, see the package README:

- [`packages/cli/README.md`](https://github.com/pdfme/pdfme/blob/main/packages/cli/README.md)
