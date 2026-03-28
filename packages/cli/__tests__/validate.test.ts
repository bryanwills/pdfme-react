import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'index.js');
const TMP = join(__dirname, '..', '.test-tmp');

function runCli(
  args: string[],
  options: { input?: string } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      input: options.input,
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

describe('validate command', () => {
  beforeAll(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('validates a valid template', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15 },
      ]],
    };
    const file = join(TMP, 'valid.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Template is valid');
    expect(result.stdout).toContain('1 page');
    expect(result.stdout).toContain('1 field');
  });

  it('reports unknown type with suggestion', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'title', type: 'textbox', position: { x: 20, y: 20 }, width: 170, height: 15 },
      ]],
    };
    const file = join(TMP, 'bad-type.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('unknown type "textbox"');
    expect(result.stdout).toContain('Did you mean: text');
  });

  it('warns about out-of-bounds field', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'wide', type: 'text', position: { x: 200, y: 20 }, width: 50, height: 15 },
      ]],
    };
    const file = join(TMP, 'oob.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file]);
    // Should pass (warnings don't cause exit 1 by default)
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('extends beyond page width');
  });

  it('--strict fails on warnings', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'wide', type: 'text', position: { x: 200, y: 20 }, width: 50, height: 15 },
      ]],
    };
    const file = join(TMP, 'oob-strict.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file, '--strict']);
    expect(result.exitCode).toBe(1);
  });

  it('--strict --json preserves the validate contract', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'wide', type: 'text', position: { x: 200, y: 20 }, width: 50, height: 15 },
      ]],
    };
    const file = join(TMP, 'oob-strict-json.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file, '--strict', '--json']);
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(parsed.warnings[0]).toContain('extends beyond page width');
    expect(parsed.inspection.schemaTypes).toEqual(['text']);
    expect(parsed.inspection.requiredPlugins).toEqual(['text']);
  });

  it('--json outputs structured result', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15 },
      ]],
    };
    const file = join(TMP, 'json-out.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('validate');
    expect(parsed.valid).toBe(true);
    expect(parsed.templatePageCount).toBe(1);
    expect(parsed.fieldCount).toBe(1);
    expect(parsed.inspection).toEqual({
      schemaTypes: ['text'],
      requiredPlugins: ['text'],
      requiredFonts: [],
      basePdf: {
        kind: 'blank',
        width: 210,
        height: 297,
        paperSize: 'A4 portrait',
      },
    });
  });

  it('supports verbose output without polluting JSON stdout', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15 },
      ]],
    };
    const file = join(TMP, 'verbose-json.json');
    writeFileSync(file, JSON.stringify(template));

    const result = spawnSync('node', [CLI, 'validate', file, '-v', '--json'], {
      encoding: 'utf8',
      timeout: 30000,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('validate');
    expect(parsed.valid).toBe(true);
    expect(result.stderr).toContain(`Input: ${file}`);
    expect(result.stderr).toContain('Mode: template');
    expect(result.stderr).toContain('Template pages: 1');
    expect(result.stderr).toContain('Warnings: 0');
  });

  it('accepts unified job files', () => {
    const file = join(TMP, 'job.json');
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
            Roboto: {
              data: 'https://fonts.example.com/Roboto.ttf',
              fallback: true,
            },
            NotoSerifJP: {
              data: 'https://fonts.example.com/NotoSerifJP.ttf',
              fallback: false,
            },
          },
        },
      }),
    );

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('validate');
    expect(parsed.mode).toBe('job');
    expect(parsed.valid).toBe(true);
    expect(parsed.inputCount).toBe(1);
    expect(parsed.inspection.schemaTypes).toEqual(['text']);
    expect(parsed.inspection.requiredPlugins).toEqual(['text']);
    expect(parsed.inspection.requiredFonts).toEqual(['NotoSerifJP']);
    expect(parsed.inspection.basePdf.kind).toBe('blank');
  });

  it('marks unified jobs invalid when multiVariableText input uses a plain string', () => {
    const file = join(TMP, 'job-invalid-mvt.json');
    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'invoiceMeta',
              type: 'multiVariableText',
              text: 'Invoice {inv}',
              variables: ['inv'],
              required: true,
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ invoiceMeta: 'INV-001' }],
      }),
    );

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Field "invoiceMeta" (multiVariableText)'),
      ]),
    );
  });

  it('accepts stdin input', () => {
    const result = runCli(['validate', '-', '--json'], {
      input: JSON.stringify({
        basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
        schemas: [[
          { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15 },
        ]],
      }),
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.mode).toBe('template');
    expect(parsed.valid).toBe(true);
    expect(parsed.inspection.schemaTypes).toEqual(['text']);
    expect(parsed.inspection.requiredFonts).toEqual([]);
  });

  it('keeps inspection summary on validation errors', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        {
          name: 'title',
          type: 'textbox',
          fontName: 'NotoSerifJP',
          position: { x: 20, y: 20 },
          width: 170,
          height: 15,
        },
      ]],
    };
    const file = join(TMP, 'json-error.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors[0]).toContain('unknown type "textbox"');
    expect(parsed.inspection).toEqual({
      schemaTypes: ['textbox'],
      requiredPlugins: [],
      requiredFonts: ['NotoSerifJP'],
      basePdf: {
        kind: 'blank',
        width: 210,
        height: 297,
        paperSize: 'A4 portrait',
      },
    });
  });

  it('returns field-level input hints for text, select, checkbox, radioGroup, and multiVariableText', () => {
    const file = join(TMP, 'input-hints.json');
    writeFileSync(
      file,
      JSON.stringify({
        basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
        schemas: [[
          {
            name: 'title',
            type: 'text',
            position: { x: 20, y: 20 },
            width: 170,
            height: 15,
          },
          {
            name: 'invoiceMeta',
            type: 'multiVariableText',
            text: 'Invoice {inv}',
            variables: ['inv'],
            required: true,
            position: { x: 20, y: 45 },
            width: 170,
            height: 15,
          },
          {
            name: 'status',
            type: 'select',
            options: ['draft', 'sent'],
            position: { x: 20, y: 70 },
            width: 170,
            height: 15,
          },
          {
            name: 'approved',
            type: 'checkbox',
            position: { x: 20, y: 95 },
            width: 10,
            height: 10,
          },
          {
            name: 'choiceA',
            type: 'radioGroup',
            group: 'choices',
            position: { x: 20, y: 115 },
            width: 10,
            height: 10,
          },
          {
            name: 'choiceB',
            type: 'radioGroup',
            group: 'choices',
            position: { x: 40, y: 115 },
            width: 10,
            height: 10,
          },
        ]],
      }),
    );

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.inputHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'title',
          type: 'text',
          pages: [1],
          expectedInput: {
            kind: 'string',
          },
        }),
        expect.objectContaining({
          name: 'invoiceMeta',
          type: 'multiVariableText',
          pages: [1],
          required: true,
          expectedInput: {
            kind: 'jsonStringObject',
            variableNames: ['inv'],
            example: '{"inv":"INV"}',
          },
        }),
        expect.objectContaining({
          name: 'status',
          type: 'select',
          pages: [1],
          expectedInput: {
            kind: 'enumString',
            allowedValues: ['draft', 'sent'],
            example: 'draft',
          },
        }),
        expect.objectContaining({
          name: 'approved',
          type: 'checkbox',
          pages: [1],
          expectedInput: {
            kind: 'enumString',
            allowedValues: ['false', 'true'],
            example: 'true',
          },
        }),
        expect.objectContaining({
          name: 'choiceA',
          type: 'radioGroup',
          pages: [1],
          expectedInput: {
            kind: 'enumString',
            allowedValues: ['false', 'true'],
            example: 'true',
            groupName: 'choices',
            groupMemberNames: ['choiceA', 'choiceB'],
          },
        }),
      ]),
    );
  });

  it('marks unified jobs invalid when select input uses a value outside schema options', () => {
    const file = join(TMP, 'job-invalid-select.json');
    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'status',
              type: 'select',
              options: ['draft', 'sent'],
              position: { x: 20, y: 20 },
              width: 170,
              height: 15,
            },
          ]],
        },
        inputs: [{ status: 'archived' }],
      }),
    );

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Field "status" (select)'),
      ]),
    );
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expects one of: "draft", "sent"'),
      ]),
    );
  });

  it('marks unified jobs invalid when checkbox input uses a boolean', () => {
    const file = join(TMP, 'job-invalid-checkbox.json');
    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'approved',
              type: 'checkbox',
              position: { x: 20, y: 20 },
              width: 10,
              height: 10,
            },
          ]],
        },
        inputs: [{ approved: true }],
      }),
    );

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Field "approved" (checkbox)'),
      ]),
    );
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expects one of: "false", "true"'),
      ]),
    );
  });

  it('marks unified jobs invalid when radioGroup sets multiple fields in the same group to true', () => {
    const file = join(TMP, 'job-invalid-radio-group.json');
    writeFileSync(
      file,
      JSON.stringify({
        template: {
          basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
          schemas: [[
            {
              name: 'choiceA',
              type: 'radioGroup',
              group: 'choices',
              position: { x: 20, y: 20 },
              width: 10,
              height: 10,
            },
            {
              name: 'choiceB',
              type: 'radioGroup',
              group: 'choices',
              position: { x: 40, y: 20 },
              width: 10,
              height: 10,
            },
          ]],
        },
        inputs: [{ choiceA: 'true', choiceB: 'true' }],
      }),
    );

    const result = runCli(['validate', file, '--json']);
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Radio group "choices"'),
      ]),
    );
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('choiceA, choiceB'),
      ]),
    );
  });

  it('rejects unknown flags with structured JSON output', () => {
    const template = {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15 },
      ]],
    };
    const file = join(TMP, 'unknown-flag.json');
    writeFileSync(file, JSON.stringify(template));

    const result = runCli(['validate', file, '--bogus', '--json']);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('EARG');
    expect(parsed.error.message).toContain('Unknown argument');
  });
});
