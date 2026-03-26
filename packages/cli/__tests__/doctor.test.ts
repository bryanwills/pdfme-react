import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const TMP = join(__dirname, '..', '.test-tmp-doctor');

function runCli(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      cwd: options.cwd,
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

describe('doctor command', () => {
  beforeAll(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('reports environment health as structured JSON', () => {
    const result = runCli(['doctor', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('environment');
    expect(parsed.healthy).toBe(true);
    expect(parsed.environment.nodeVersion).toMatch(/^v/);
    expect(parsed.environment.cliVersion).toBeTruthy();
    expect(parsed.environment.cwd.path).toBeTruthy();
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  it('rejects invalid imageFormat even for environment-only doctor runs', () => {
    const result = runCli(['doctor', '--imageFormat', 'gif', '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EARG');
    expect(parsed.error.message).toContain('--imageFormat');
  });

  it('reports basePdf and missing-font issues without crashing', () => {
    const file = join(TMP, 'doctor-missing-assets.json');
    writeFileSync(
      file,
      JSON.stringify({
        basePdf: './missing.pdf',
        schemas: [[
          {
            name: 'title',
            type: 'text',
            fontName: 'NotoSerifJP',
            position: { x: 20, y: 20 },
            width: 170,
            height: 15,
          },
        ]],
      }),
    );

    const result = runCli(['doctor', file, '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('input');
    expect(parsed.healthy).toBe(false);
    expect(parsed.diagnosis.basePdf.kind).toBe('pdfPath');
    expect(parsed.diagnosis.basePdf.exists).toBe(false);
    expect(parsed.diagnosis.fonts.missingFonts).toEqual(['NotoSerifJP']);
    expect(parsed.issues).toContain(
      `Template references font(s) that are not available by default: NotoSerifJP. Provide them via generate --font or unified job options.font.`,
    );
    expect(parsed.issues.some((issue: string) => issue.includes('Base PDF file not found'))).toBe(true);
  });

  it('treats a job with explicit fonts as healthy', () => {
    const file = join(TMP, 'doctor-job.json');
    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'NotoSerifJP',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            NotoSerifJP: {
              data: 'https://fonts.example.com/NotoSerifJP.ttf',
            },
          },
        },
      }),
    );

    const result = runCli(['doctor', file, '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.healthy).toBe(true);
    expect(parsed.mode).toBe('job');
    expect(parsed.validation.valid).toBe(true);
    expect(parsed.diagnosis.fonts.explicitFonts).toEqual(['NotoSerifJP']);
    expect(parsed.diagnosis.fonts.effectiveFonts).toEqual(['NotoSerifJP', 'Roboto']);
    expect(parsed.issues).toEqual([]);
  });

  it('fails when CJK auto-font needs a non-writable empty cache', () => {
    const homeDir = join(TMP, 'readonly-home');
    const file = join(TMP, 'doctor-cjk-job.json');
    rmSync(homeDir, { recursive: true, force: true });
    mkdirSync(homeDir, { recursive: true });

    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'こんにちは' }],
      }),
    );

    chmodSync(homeDir, 0o555);

    try {
      const result = runCli(['doctor', file, '--json'], {
        env: { ...process.env, HOME: homeDir },
      });

      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.healthy).toBe(false);
      expect(parsed.diagnosis.fonts.autoNotoSansJP.needed).toBe(true);
      expect(parsed.diagnosis.fonts.autoNotoSansJP.cached).toBe(false);
      expect(parsed.issues.some((issue: string) => issue.includes('font cache directory is not writable'))).toBe(true);
    } finally {
      chmodSync(homeDir, 0o755);
    }
  });

  it('diagnoses local font sources and rejects unsupported formats', () => {
    const workDir = join(TMP, 'doctor-font-sources');
    const file = join(workDir, 'job.json');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'BrandTtf.ttf'), 'fake-ttf');
    writeFileSync(join(workDir, 'BrandOtf.otf'), 'fake-otf');

    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'BrandTtf',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
            {
              name: 'subtitle',
              type: 'text',
              fontName: 'BrandOtf',
              position: { x: 20, y: 45 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'Hello', subtitle: 'World' }],
        options: {
          font: {
            BrandTtf: {
              data: './BrandTtf.ttf',
            },
            BrandOtf: {
              data: './BrandOtf.otf',
            },
          },
        },
      }),
    );

    const result = runCli(['doctor', 'fonts', file, '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('fonts');
    expect(parsed.healthy).toBe(false);
    expect(parsed.diagnosis.fonts.requiredFonts).toEqual(['BrandOtf', 'BrandTtf']);
    expect(parsed.diagnosis.fonts.explicitSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fontName: 'BrandTtf',
          kind: 'localPath',
          exists: true,
          supportedFormat: true,
          formatHint: 'ttf',
        }),
        expect.objectContaining({
          fontName: 'BrandOtf',
          kind: 'localPath',
          exists: true,
          supportedFormat: false,
          formatHint: 'otf',
        }),
      ]),
    );
    expect(parsed.issues.some((issue: string) => issue.includes('uses .otf'))).toBe(true);
  });

  it('focuses on font issues without failing on basePdf path problems', () => {
    const workDir = join(TMP, 'doctor-font-only');
    const file = join(workDir, 'job.json');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'BrandTtf.ttf'), 'fake-ttf');

    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: './missing.pdf',
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'BrandTtf',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            BrandTtf: {
              data: './BrandTtf.ttf',
            },
          },
        },
      }),
    );

    const result = runCli(['doctor', 'fonts', file, '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('fonts');
    expect(parsed.healthy).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.diagnosis.fonts.explicitSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fontName: 'BrandTtf',
          kind: 'localPath',
          exists: true,
          supportedFormat: true,
        }),
      ]),
    );
  });

  it('reports implicit default output collisions as blocking runtime issues', () => {
    const workDir = join(TMP, 'doctor-runtime-default-output');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'output.pdf'), 'existing-pdf');
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
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
      }),
    );

    const result = runCli(['doctor', 'job.json', '--json'], { cwd: workDir });

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('input');
    expect(parsed.healthy).toBe(false);
    expect(parsed.diagnosis.runtime.output.implicitDefaultProtected).toBe(true);
    expect(parsed.issues).toContain(
      `Refusing to overwrite implicit default output file: ${join(workDir, 'output.pdf')}. Use -o to choose an explicit path or --force to overwrite.`,
    );
  });

  it('reports explicit output and image paths in runtime diagnosis', () => {
    const workDir = join(TMP, 'doctor-runtime-explicit-output');
    const file = join(workDir, 'job.json');
    const outputPath = join(workDir, 'artifacts', 'out.pdf');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'One' }, { title: 'Two' }],
      }),
    );

    const result = runCli(['doctor', file, '-o', outputPath, '--image', '--imageFormat', 'jpeg', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('input');
    expect(parsed.healthy).toBe(true);
    expect(parsed.diagnosis.runtime.estimatedPages).toBe(2);
    expect(parsed.diagnosis.runtime.output).toEqual(
      expect.objectContaining({
        path: outputPath,
        resolvedPath: outputPath,
        writable: true,
        implicitDefaultProtected: false,
      }),
    );
    expect(parsed.diagnosis.runtime.imageOutputs).toEqual({
      enabled: true,
      format: 'jpeg',
      directory: join(workDir, 'artifacts'),
      paths: [join(workDir, 'artifacts', 'out-1.jpg'), join(workDir, 'artifacts', 'out-2.jpg')],
    });
  });

  it('ignores runtime flags for doctor fonts health checks', () => {
    const workDir = join(TMP, 'doctor-fonts-ignore-runtime');
    const file = join(workDir, 'job.json');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'BrandTtf.ttf'), 'fake-ttf');
    writeFileSync(join(workDir, 'output.pdf'), 'existing-pdf');

    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              fontName: 'BrandTtf',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
        options: {
          font: {
            BrandTtf: {
              data: './BrandTtf.ttf',
            },
          },
        },
      }),
    );

    const result = runCli(
      ['doctor', 'fonts', 'job.json', '-o', 'output.pdf', '--image', '--imageFormat', 'jpeg', '--json'],
      { cwd: workDir },
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.target).toBe('fonts');
    expect(parsed.healthy).toBe(true);
    expect(parsed.issues).toEqual([]);
  });

  it('rejects invalid imageFormat for doctor fonts as an argument error', () => {
    const workDir = join(TMP, 'doctor-fonts-invalid-image-format');
    const file = join(workDir, 'job.json');
    mkdirSync(workDir, { recursive: true });

    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'title',
              type: 'text',
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ title: 'Hello' }],
      }),
    );

    const result = runCli(['doctor', 'fonts', file, '--imageFormat', 'gif', '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EARG');
    expect(parsed.error.message).toContain('--imageFormat');
  });
});
