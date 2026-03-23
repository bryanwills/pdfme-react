import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import examplesCmd from '../src/commands/examples.js';
import {
  fetchExampleTemplate,
  getExampleManifest,
  getExampleTemplateNames,
} from '../src/example-templates.js';
import { OFFICIAL_EXAMPLE_FONT_URLS } from '../src/example-fonts.js';
import { CLI_VERSION } from '../src/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', '.test-tmp-examples');

describe('examples command', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PDFME_EXAMPLES_BASE_URL;
    delete process.env.PDFME_EXAMPLES_CACHE_DIR;
    rmSync(TMP, { recursive: true, force: true });
  });

  it('fetches the version-pinned manifest for --list output', async () => {
    process.env.PDFME_EXAMPLES_CACHE_DIR = TMP;

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        `https://playground.pdfme.com/template-assets/manifests/${encodeURIComponent(CLI_VERSION)}.json`,
      );
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          cliVersion: CLI_VERSION,
          templates: [{ name: 'zeta' }, { name: 'alpha' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await examplesCmd.run!({
      args: { list: true, name: undefined, latest: false, json: false },
      rawArgs: [],
      cmd: examplesCmd,
    } as never);

    expect(logSpy.mock.calls.map(([message]) => message)).toEqual([
      'Available templates:',
      '  alpha',
      '  zeta',
    ]);
  });

  it('falls back to the local cache when the remote manifest is unavailable', async () => {
    process.env.PDFME_EXAMPLES_CACHE_DIR = TMP;
    mkdirSync(TMP, { recursive: true });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            cliVersion: CLI_VERSION,
            templates: [{ name: 'invoice', author: 'pdfme' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    const warm = await getExampleManifest();
    expect(warm.source).toBe('remote');

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const cached = await getExampleManifest();
    expect(cached.source).toBe('cache');
    expect(cached.manifest.templates).toEqual([{ name: 'invoice', author: 'pdfme' }]);
  });

  it('loads a template from cache when remote template fetch fails', async () => {
    process.env.PDFME_EXAMPLES_CACHE_DIR = TMP;
    process.env.PDFME_EXAMPLES_BASE_URL = 'https://fixtures.example.com/template-assets';

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith(`/manifests/${encodeURIComponent(CLI_VERSION)}.json`)) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            cliVersion: CLI_VERSION,
            templates: [{ name: 'invoice', path: 'invoice/template.json' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url.endsWith('/invoice/template.json')) {
        return new Response(
          JSON.stringify({
            basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
            schemas: [[{ name: 'title', type: 'text' }]],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    const firstNames = await getExampleTemplateNames();
    expect(firstNames).toEqual(['invoice']);
    await fetchExampleTemplate('invoice');

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/manifests/${encodeURIComponent(CLI_VERSION)}.json`)) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            cliVersion: CLI_VERSION,
            templates: [{ name: 'invoice', path: 'invoice/template.json' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error('template fetch offline');
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await examplesCmd.run!({
      args: {
        list: false,
        name: 'invoice',
        output: undefined,
        withInputs: true,
        latest: false,
        json: true,
      },
      rawArgs: [],
      cmd: examplesCmd,
    } as never);

    const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? 'null'));
    expect(payload.ok).toBe(true);
    expect(payload.source).toBe('cache');
    expect(payload.mode).toBe('job');
    expect(payload.data.inputs).toEqual([{ title: 'Sample title' }]);
  });

  it('writes output files and emits structured JSON', async () => {
    process.env.PDFME_EXAMPLES_CACHE_DIR = TMP;
    process.env.PDFME_EXAMPLES_BASE_URL = 'https://fixtures.example.com/template-assets';
    mkdirSync(TMP, { recursive: true });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith(`/manifests/${encodeURIComponent(CLI_VERSION)}.json`)) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            cliVersion: CLI_VERSION,
            templates: [{ name: 'invoice', path: 'invoice/template.json' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url.endsWith('/invoice/template.json')) {
        return new Response(
          JSON.stringify({
            basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
            schemas: [[{ name: 'title', type: 'text' }]],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const outputPath = join(TMP, 'job.json');

    await examplesCmd.run!({
      args: {
        list: false,
        name: 'invoice',
        output: outputPath,
        withInputs: true,
        latest: false,
        json: true,
      },
      rawArgs: [],
      cmd: examplesCmd,
    } as never);

    const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? 'null'));
    expect(payload.ok).toBe(true);
    expect(payload.outputPath).toBe(outputPath);

    const written = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written.inputs).toEqual([{ title: 'Sample title' }]);
  });

  it('embeds official example font URLs into unified jobs', async () => {
    process.env.PDFME_EXAMPLES_CACHE_DIR = TMP;
    process.env.PDFME_EXAMPLES_BASE_URL = 'https://fixtures.example.com/template-assets';
    mkdirSync(TMP, { recursive: true });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith(`/manifests/${encodeURIComponent(CLI_VERSION)}.json`)) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            cliVersion: CLI_VERSION,
            templates: [{ name: 'certificate-black', path: 'certificate-black/template.json' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url.endsWith('/certificate-black/template.json')) {
        return new Response(
          JSON.stringify({
            basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
            schemas: [[
              {
                name: 'signature',
                type: 'text',
                fontName: 'PinyonScript-Regular',
                position: { x: 20, y: 20 },
                width: 100,
                height: 20,
              },
            ]],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }));

    const outputPath = join(TMP, 'certificate-job.json');

    await examplesCmd.run!({
      args: {
        list: false,
        name: 'certificate-black',
        output: outputPath,
        withInputs: true,
        latest: false,
        json: true,
      },
      rawArgs: [],
      cmd: examplesCmd,
    } as never);

    const written = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(written.options.font).toEqual({
      'PinyonScript-Regular': {
        data: OFFICIAL_EXAMPLE_FONT_URLS['PinyonScript-Regular'],
        fallback: false,
        subset: true,
      },
    });
  });
});
