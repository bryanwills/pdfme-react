import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from '@pdfme/pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const OFFLINE_PRELOAD = pathToFileURL(join(__dirname, 'fixtures', 'offline-fetch-loader.mjs')).href;
const FIXTURE_PRELOAD = pathToFileURL(join(__dirname, 'fixtures', 'fetch-fixture-loader.mjs')).href;
const TMP = join(__dirname, '..', '.test-tmp-generate');
const ASSETS_DIR = resolve(__dirname, '..', '..', '..', 'playground', 'public', 'template-assets');
const FONT_FIXTURES_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'generator',
  '__tests__',
  'assets',
  'fonts',
);

function runCli(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; preload?: string } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const nodeArgs = options.preload ? ['--import', options.preload, CLI, ...args] : [CLI, ...args];
    const stdout = execFileSync('node', nodeArgs, {
      encoding: 'utf8',
      timeout: 30000,
      env: options.env,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.status ?? 1,
    };
  }
}

function createFixtureEnv(rootDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: join(rootDir, 'home'),
    PDFME_EXAMPLES_BASE_URL: 'https://fixtures.example.com/template-assets',
    PDFME_TEST_ASSETS_DIR: ASSETS_DIR,
    PDFME_TEST_FONT_FIXTURES_DIR: FONT_FIXTURES_DIR,
  };
}

describe('generate command', () => {
  beforeAll(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('resolves template basePdf paths relative to the job file', async () => {
    const workDir = join(TMP, 'relative-base');
    mkdirSync(workDir, { recursive: true });

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    page.drawText('Base PDF');
    writeFileSync(join(workDir, 'base.pdf'), await pdfDoc.save());

    const outputPath = join(workDir, 'out.pdf');
    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: './base.pdf',
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 80,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
      }),
    );

    const result = runCli(['generate', join(workDir, 'job.json'), '-o', outputPath, '--json']);
    expect(result.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.pdf).toBe(outputPath);
    expect(parsed.pages).toBe(1);
  });

  it('fails with a validation error instead of crashing on invalid input', () => {
    const jobPath = join(TMP, 'invalid-job.json');
    writeFileSync(
      jobPath,
      JSON.stringify({
        template: { basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] } },
        inputs: {},
      }),
    );

    const result = runCli(['generate', jobPath]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Invalid generation input.');
    expect(result.stderr).toContain('Invalid argument');
    expect(result.stderr).not.toContain('TypeError');
  });

  it('writes actual jpeg bytes when grid output is requested in jpeg mode', () => {
    const workDir = join(TMP, 'grid-jpeg');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
      }),
    );

    const result = runCli([
      'generate',
      join(workDir, 'job.json'),
      '-o',
      join(workDir, 'out.pdf'),
      '--grid',
      '--imageFormat',
      'jpeg',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    const output = readFileSync(join(workDir, 'out-1.jpg'));
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);
    expect(output[2]).toBe(0xff);
  });

  it('returns structured JSON for argument validation failures', () => {
    const workDir = join(TMP, 'bad-scale');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
      }),
    );

    const result = runCli([
      'generate',
      join(workDir, 'job.json'),
      '--scale',
      'nope',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EARG');
    expect(parsed.error.message).toContain('--scale');
  });

  it('returns structured EVALIDATE for unknown schema types', () => {
    const workDir = join(TMP, 'unknown-type');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'textbox',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
      }),
    );

    const result = runCli([
      'generate',
      join(workDir, 'job.json'),
      '-o',
      join(workDir, 'out.pdf'),
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EVALIDATE');
    expect(parsed.error.message).toContain('unknown type "textbox"');
  });

  it('returns structured EUNSUPPORTED for unsupported custom font formats', () => {
    const workDir = join(TMP, 'unsupported-font-format');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(join(workDir, 'FakeFont.otf'), 'not-a-real-font');
    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
      }),
    );

    const result = runCli([
      'generate',
      join(workDir, 'job.json'),
      '--font',
      `Fake=${join(workDir, 'FakeFont.otf')}`,
      '-o',
      join(workDir, 'out.pdf'),
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EUNSUPPORTED');
    expect(parsed.error.message).toContain('Unsupported font format');
  });

  it('resolves local options.font paths relative to the job file', () => {
    const workDir = join(TMP, 'options-font-local-path');
    const fontPath = resolve(FONT_FIXTURES_DIR, 'PinyonScript-Regular.ttf');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(join(workDir, 'PinyonScript-Regular.ttf'), readFileSync(fontPath));
    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'PinyonScript',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            PinyonScript: {
              data: './PinyonScript-Regular.ttf',
              subset: true,
            },
          },
        },
      }),
    );

    const outputPath = join(workDir, 'out.pdf');
    const result = runCli(['generate', join(workDir, 'job.json'), '-o', outputPath, '--json']);

    expect(result.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.pdf).toBe(outputPath);
  });

  it('supports https ttf URLs in options.font', () => {
    const workDir = join(TMP, 'options-font-url');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'PinyonScript',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            PinyonScript: {
              data: 'https://fonts.gstatic.com/s/pinyonscript/v22/6xKpdSJbL9-e9LuoeQiDRQR8aOLQO4bhiDY.ttf',
              subset: true,
            },
          },
        },
      }),
    );

    const outputPath = join(workDir, 'out.pdf');
    const result = runCli(
      ['generate', join(workDir, 'job.json'), '-o', outputPath, '--json'],
      {
        preload: FIXTURE_PRELOAD,
        env: createFixtureEnv(workDir),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.pdf).toBe(outputPath);
  });

  it('supports data URI ttf sources in options.font', () => {
    const workDir = join(TMP, 'options-font-data-uri');
    const fontData = readFileSync(resolve(FONT_FIXTURES_DIR, 'PinyonScript-Regular.ttf')).toString('base64');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'PinyonScript',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            PinyonScript: {
              data: `data:font/ttf;base64,${fontData}`,
              subset: true,
            },
          },
        },
      }),
    );

    const outputPath = join(workDir, 'out.pdf');
    const result = runCli(['generate', join(workDir, 'job.json'), '-o', outputPath, '--json']);

    expect(result.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.pdf).toBe(outputPath);
  });

  it('returns structured EIO for missing local options.font files', () => {
    const workDir = join(TMP, 'options-font-missing-local');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'PinyonScript',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            PinyonScript: {
              data: './MissingFont.ttf',
              subset: true,
            },
          },
        },
      }),
    );

    const result = runCli(['generate', join(workDir, 'job.json'), '--json']);

    expect(result.exitCode).toBe(3);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EIO');
    expect(parsed.error.message).toContain('Font file for PinyonScript not found');
  });

  it('returns structured EUNSUPPORTED for unsupported options.font sources', () => {
    const workDir = join(TMP, 'options-font-unsupported-source');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'FakeFont.otf'), 'not-a-real-font');

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'PinyonScript',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            PinyonScript: {
              data: './FakeFont.otf',
              subset: true,
            },
          },
        },
      }),
    );

    const result = runCli(['generate', join(workDir, 'job.json'), '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EUNSUPPORTED');
    expect(parsed.error.message).toContain('.otf');
  });

  it('prefers --font over conflicting options.font entries', () => {
    const workDir = join(TMP, 'font-cli-override-precedence');
    const fontPath = resolve(FONT_FIXTURES_DIR, 'PinyonScript-Regular.ttf');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'PinyonScript',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            PinyonScript: {
              data: './MissingFont.ttf',
              subset: true,
            },
          },
        },
      }),
    );

    const outputPath = join(workDir, 'out.pdf');
    const result = runCli([
      'generate',
      join(workDir, 'job.json'),
      '--font',
      `PinyonScript=${fontPath}`,
      '-o',
      outputPath,
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.pdf).toBe(outputPath);
  });

  it('returns structured EFONT when CJK text is present and --noAutoFont disables fallback resolution', () => {
    const workDir = join(TMP, 'cjk-no-auto-font');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'こんにちは' }],
      }),
    );

    const result = runCli([
      'generate',
      join(workDir, 'job.json'),
      '--noAutoFont',
      '-o',
      join(workDir, 'out.pdf'),
      '--json',
    ]);

    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EFONT');
    expect(parsed.error.message).toContain('CJK text detected');
    expect(parsed.error.message).toContain('--noAutoFont');
  });

  it('returns structured EFONT when automatic CJK font download is unavailable', () => {
    const workDir = join(TMP, 'cjk-offline');
    mkdirSync(workDir, { recursive: true });
    mkdirSync(join(workDir, 'home'), { recursive: true });

    writeFileSync(
      join(workDir, 'job.json'),
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
          ]],
        },
        inputs: [{ title: 'こんにちは' }],
      }),
    );

    const result = runCli(
      [
        'generate',
        join(workDir, 'job.json'),
        '-o',
        join(workDir, 'out.pdf'),
        '--json',
      ],
      {
        preload: OFFLINE_PRELOAD,
        env: { ...process.env, HOME: join(workDir, 'home') },
      },
    );

    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EFONT');
    expect(parsed.error.message).toContain('could not be resolved automatically');
  });

  it('refuses to overwrite implicit default output.pdf without --force', () => {
    const workDir = join(TMP, 'default-output-safety');
    mkdirSync(workDir, { recursive: true });

    const previousCwd = process.cwd();
    process.chdir(workDir);

    try {
      writeFileSync('output.pdf', 'existing file');
      writeFileSync(
        'job.json',
        JSON.stringify({
          template: {
            basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
            schemas: [[
              {
                name: 'title',
                type: 'text',
                position: { x: 20, y: 20 },
                width: 100,
                height: 10,
              },
            ]],
          },
          inputs: [{ title: 'Hello' }],
        }),
      );

      const result = runCli(['generate', 'job.json', '--json']);
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.message).toContain('Refusing to overwrite implicit default output file');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
