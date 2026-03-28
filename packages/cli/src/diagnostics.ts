import { dirname, resolve } from 'node:path';
import { checkTemplate } from '@pdfme/common';
import { fail } from './contract.js';
import { schemaTypes } from './schema-plugins.js';
import { detectPaperSize, readJsonFile, readJsonFromStdin } from './utils.js';

export const KNOWN_TEMPLATE_KEYS = new Set(['author', 'basePdf', 'columns', 'pdfmeVersion', 'schemas']);
export const KNOWN_JOB_KEYS = new Set(['template', 'inputs', 'options']);

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  pages: number;
  fields: number;
}

export interface ValidationInspection {
  schemaTypes: string[];
  requiredPlugins: string[];
  requiredFonts: string[];
  basePdf: {
    kind: string;
    width?: number;
    height?: number;
    paperSize?: string | null;
    path?: string;
    resolvedPath?: string;
  };
}

export interface FieldInputHint {
  name: string;
  type: string;
  pages: number[];
  required: boolean;
  expectedInput: {
    kind: 'string' | 'jsonStringObject' | 'enumString';
    variableNames?: string[];
    allowedValues?: string[];
    example?: string;
  };
}

export interface ValidationSource {
  mode: 'template' | 'job';
  template: Record<string, unknown>;
  inputs?: Record<string, unknown>[];
  options?: unknown;
  templateDir?: string;
  jobWarnings: string[];
}

export function findClosestType(type: string): string | null {
  let bestMatch: string | null = null;
  let bestDist = Infinity;
  for (const known of schemaTypes) {
    const dist = levenshtein(type.toLowerCase(), known.toLowerCase());
    if (dist < bestDist && dist <= 3) {
      bestDist = dist;
      bestMatch = known;
    }
  }
  return bestMatch;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

export function validateTemplate(template: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    checkTemplate(template);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const schemaPages = normalizeSchemaPages(template.schemas);
  if (schemaPages.length === 0) {
    return { errors, warnings, pages: 0, fields: 0 };
  }

  const totalFields = schemaPages.reduce((sum, page) => sum + page.length, 0);
  let pageWidth = 210;
  let pageHeight = 297;
  if (
    template.basePdf &&
    typeof template.basePdf === 'object' &&
    'width' in (template.basePdf as object)
  ) {
    pageWidth = (template.basePdf as { width: number }).width;
    pageHeight = (template.basePdf as { height: number }).height;
  }

  const allNames = new Map<string, number[]>();

  for (let pageIdx = 0; pageIdx < schemaPages.length; pageIdx++) {
    const page = schemaPages[pageIdx];
    if (!Array.isArray(page)) continue;

    const pageNames = new Set<string>();

    for (const schema of page) {
      if (typeof schema !== 'object' || schema === null) continue;

      const name = schema.name as string;
      const type = schema.type as string;
      const position = schema.position as { x: number; y: number } | undefined;
      const width = schema.width as number | undefined;
      const height = schema.height as number | undefined;

      if (type && !schemaTypes.has(type)) {
        const suggestion = findClosestType(type);
        const hint = suggestion ? ` Did you mean: ${suggestion}?` : '';
        errors.push(
          `Field "${name}" has unknown type "${type}".${hint} Available types: ${[...schemaTypes].join(', ')}`,
        );
      }

      if (name && pageNames.has(name)) {
        errors.push(`Duplicate field name "${name}" on page ${pageIdx + 1}`);
      }

      if (name) {
        pageNames.add(name);
        if (!allNames.has(name)) allNames.set(name, []);
        allNames.get(name)!.push(pageIdx + 1);
      }

      if (position && width !== undefined && height !== undefined) {
        if (position.x + width > pageWidth + 1) {
          warnings.push(
            `Field "${name}" at (${position.x},${position.y}) extends beyond page width (${pageWidth}mm)`,
          );
        }
        if (position.y + height > pageHeight + 1) {
          warnings.push(
            `Field "${name}" at (${position.x},${position.y}) extends beyond page height (${pageHeight}mm)`,
          );
        }
        if (position.x < 0 || position.y < 0) {
          warnings.push(`Field "${name}" has negative position (${position.x},${position.y})`);
        }
      }
    }
  }

  for (const [name, pages] of allNames) {
    if (pages.length > 1) {
      warnings.push(`Field name "${name}" appears on multiple pages: ${pages.join(', ')}`);
    }
  }

  return { errors, warnings, pages: schemaPages.length, fields: totalFields };
}

export function inspectTemplate(
  template: Record<string, unknown>,
  templateDir?: string,
): ValidationInspection {
  const schemaPages = normalizeSchemaPages(template.schemas);
  const flattenedSchemas = schemaPages.flat();
  const collectedSchemaTypes = getUniqueStringValues(flattenedSchemas.map((schema) => schema.type));
  const requiredFonts = getUniqueStringValues(flattenedSchemas.map((schema) => schema.fontName));

  return {
    schemaTypes: collectedSchemaTypes,
    requiredPlugins: collectedSchemaTypes.filter((type) => schemaTypes.has(type)),
    requiredFonts,
    basePdf: summarizeBasePdf(template.basePdf, templateDir),
  };
}

export function collectInputHints(template: Record<string, unknown>): FieldInputHint[] {
  const hintMap = new Map<string, FieldInputHint>();
  const schemaPages = normalizeSchemaPages(template.schemas);

  for (let pageIdx = 0; pageIdx < schemaPages.length; pageIdx++) {
    for (const schema of schemaPages[pageIdx]) {
      const name = typeof schema.name === 'string' ? schema.name : '';
      const type = typeof schema.type === 'string' ? schema.type : '';
      const readOnly = schema.readOnly === true;

      if (!name || !type || readOnly) {
        continue;
      }

      const hint = buildFieldInputHint(schema, pageIdx + 1);
      const key = [
        hint.name,
        hint.type,
        hint.expectedInput.kind,
        hint.expectedInput.example ?? '',
        (hint.expectedInput.variableNames ?? []).join('\u0000'),
        (hint.expectedInput.allowedValues ?? []).join('\u0000'),
      ].join('\u0001');
      const existing = hintMap.get(key);

      if (existing) {
        existing.pages = [...new Set([...existing.pages, pageIdx + 1])].sort((a, b) => a - b);
        existing.required = existing.required || hint.required;
        continue;
      }

      hintMap.set(key, hint);
    }
  }

  return [...hintMap.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type),
  );
}

export function validateInputContracts(
  template: Record<string, unknown>,
  inputs: Record<string, unknown>[],
): void {
  const issues = getInputContractIssues(template, inputs);
  if (issues.length > 0) {
    fail(issues[0], { code: 'EVALIDATE', exitCode: 1 });
  }
}

export function getInputContractIssues(
  template: Record<string, unknown>,
  inputs: Record<string, unknown>[],
): string[] {
  const hints = collectInputHints(template);
  const issues: string[] = [];

  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
    const input = inputs[inputIndex] ?? {};

    for (const hint of hints) {
      const issue = getInputContractIssue(hint, input, inputIndex);
      if (issue) {
        issues.push(issue);
      }
    }
  }

  return issues;
}

export async function loadValidationSource(
  file: string | undefined,
  options: { noInputMessage: string },
): Promise<ValidationSource> {
  const data = await loadValidationInput(file, options.noInputMessage);
  const record = assertRecordObject(data.json, 'Validation input');
  const hasTemplate = 'template' in record;
  const hasInputs = 'inputs' in record;

  if (hasTemplate || hasInputs) {
    if (!hasTemplate || !hasInputs) {
      fail('Unified job validation requires both "template" and "inputs" keys.', {
        code: 'EARG',
        exitCode: 1,
      });
    }

    return {
      mode: 'job',
      template: assertRecordObject(record.template, 'Unified job template'),
      inputs: record.inputs as Record<string, unknown>[],
      options: record.options,
      templateDir: data.templateDir,
      jobWarnings: Object.keys(record)
        .filter((key) => !KNOWN_JOB_KEYS.has(key))
        .sort()
        .map((key) => `Unknown unified job field: ${key}`),
    };
  }

  return {
    mode: 'template',
    template: assertRecordObject(record, 'Template'),
    templateDir: data.templateDir,
    jobWarnings: [],
  };
}

async function loadValidationInput(
  file: string | undefined,
  noInputMessage: string,
): Promise<{ json: unknown; templateDir?: string }> {
  if (!file || file === '-') {
    if (file === '-' || !process.stdin.isTTY) {
      return { json: await readJsonFromStdin() };
    }

    fail(noInputMessage, {
      code: 'EARG',
      exitCode: 1,
    });
  }

  const resolvedFile = resolve(file);
  return {
    json: readJsonFile(resolvedFile),
    templateDir: dirname(resolvedFile),
  };
}

function assertRecordObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`, { code: 'EARG', exitCode: 1 });
  }

  return value as Record<string, unknown>;
}

export function normalizeSchemaPages(rawSchemas: unknown): Array<Array<Record<string, unknown>>> {
  if (!Array.isArray(rawSchemas)) {
    return [];
  }

  return rawSchemas.map((page) => {
    if (Array.isArray(page)) {
      return page.filter(
        (schema): schema is Record<string, unknown> => typeof schema === 'object' && schema !== null,
      );
    }

    if (typeof page === 'object' && page !== null) {
      return Object.values(page).filter(
        (schema): schema is Record<string, unknown> => typeof schema === 'object' && schema !== null,
      );
    }

    return [];
  });
}

function buildFieldInputHint(
  schema: Record<string, unknown>,
  page: number,
): FieldInputHint {
  const type = schema.type as string;

  if (type === 'multiVariableText') {
    const variableNames = getUniqueStringValues(
      Array.isArray(schema.variables) ? schema.variables : [],
    );

    return {
      name: schema.name as string,
      type,
      pages: [page],
      required: schema.required === true,
      expectedInput: {
        kind: 'jsonStringObject',
        variableNames,
        example: buildMultiVariableTextExample(variableNames),
      },
    };
  }

  if (type === 'checkbox') {
    return {
      name: schema.name as string,
      type,
      pages: [page],
      required: schema.required === true,
      expectedInput: {
        kind: 'enumString',
        allowedValues: ['false', 'true'],
        example: 'true',
      },
    };
  }

  if (type === 'select') {
    const allowedValues = getUniqueOrderedStringValues(
      Array.isArray(schema.options) ? schema.options : [],
    );

    if (allowedValues.length > 0) {
      return {
        name: schema.name as string,
        type,
        pages: [page],
        required: schema.required === true,
        expectedInput: {
          kind: 'enumString',
          allowedValues,
          example: allowedValues[0],
        },
      };
    }
  }

  return {
    name: schema.name as string,
    type,
    pages: [page],
    required: schema.required === true,
    expectedInput: {
      kind: 'string',
    },
  };
}

function buildMultiVariableTextExample(variableNames: string[]): string {
  return JSON.stringify(
    Object.fromEntries(
      variableNames.map((variableName) => [variableName, variableName.toUpperCase()]),
    ),
  );
}

function getInputContractIssue(
  hint: FieldInputHint,
  input: Record<string, unknown>,
  inputIndex: number,
): string | null {
  if (hint.expectedInput.kind === 'jsonStringObject') {
    return getMultiVariableTextInputIssue(hint, input, inputIndex);
  }

  if (hint.expectedInput.kind === 'enumString') {
    return getEnumStringInputIssue(hint, input, inputIndex);
  }

  return null;
}

function getMultiVariableTextInputIssue(
  hint: FieldInputHint,
  input: Record<string, unknown>,
  inputIndex: number,
): string | null {
  const rawValue = input[hint.name];
  const variableNames = hint.expectedInput.variableNames ?? [];
  const example = hint.expectedInput.example ?? '{}';

  if (rawValue === undefined || rawValue === '') {
    if (!hint.required || variableNames.length === 0) {
      return null;
    }

    return buildMultiVariableTextErrorMessage({
      hint,
      inputIndex,
      extra: `Missing variables: ${variableNames.join(', ')}.`,
      example,
    });
  }

  if (typeof rawValue !== 'string') {
    return buildMultiVariableTextErrorMessage({
      hint,
      inputIndex,
      extra: `Received ${describeValue(rawValue)}.`,
      example,
    });
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    return buildMultiVariableTextErrorMessage({
      hint,
      inputIndex,
      extra: `Received ${describeValue(rawValue)}.`,
      example,
    });
  }

  if (typeof parsedValue !== 'object' || parsedValue === null || Array.isArray(parsedValue)) {
    return buildMultiVariableTextErrorMessage({
      hint,
      inputIndex,
      extra: `Received ${describeValue(parsedValue)}.`,
      example,
    });
  }

  if (!hint.required || variableNames.length === 0) {
    return null;
  }

  const values = parsedValue as Record<string, unknown>;
  const missingVariables = variableNames.filter((variableName) => !values[variableName]);
  if (missingVariables.length > 0) {
    return buildMultiVariableTextErrorMessage({
      hint,
      inputIndex,
      extra: `Missing variables: ${missingVariables.join(', ')}.`,
      example,
    });
  }

  return null;
}

function getEnumStringInputIssue(
  hint: FieldInputHint,
  input: Record<string, unknown>,
  inputIndex: number,
): string | null {
  const rawValue = input[hint.name];
  const allowedValues = hint.expectedInput.allowedValues ?? [];
  const example = hint.expectedInput.example;

  if (rawValue === undefined || rawValue === '') {
    return null;
  }

  if (typeof rawValue !== 'string') {
    return buildEnumStringErrorMessage({
      hint,
      inputIndex,
      extra: `Received ${describeValue(rawValue)}.`,
      example,
    });
  }

  if (allowedValues.length === 0 || allowedValues.includes(rawValue)) {
    return null;
  }

  return buildEnumStringErrorMessage({
    hint,
    inputIndex,
    extra: `Received ${describeValue(rawValue)}.`,
    example,
  });
}

function buildMultiVariableTextErrorMessage(args: {
  hint: FieldInputHint;
  inputIndex: number;
  extra: string;
  example: string;
}): string {
  const variableLabel =
    args.hint.expectedInput.variableNames && args.hint.expectedInput.variableNames.length > 0
      ? ` with variables: ${args.hint.expectedInput.variableNames.join(', ')}`
      : '';

  return `Field "${args.hint.name}" (multiVariableText) in input ${args.inputIndex + 1} expects a JSON string object${variableLabel}. Example: ${args.example}. ${args.extra}`;
}

function buildEnumStringErrorMessage(args: {
  hint: FieldInputHint;
  inputIndex: number;
  extra: string;
  example?: string;
}): string {
  const allowedValues = (args.hint.expectedInput.allowedValues ?? []).map((value) => JSON.stringify(value));
  const allowedLabel =
    allowedValues.length > 0 ? ` one of: ${allowedValues.join(', ')}` : ' a supported string value';
  const exampleLabel =
    args.example !== undefined ? ` Example: ${JSON.stringify(args.example)}.` : '';

  return `Field "${args.hint.name}" (${args.hint.type}) in input ${args.inputIndex + 1} expects${allowedLabel}.${exampleLabel} ${args.extra}`.trim();
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const kind =
      trimmed.startsWith('{') || trimmed.startsWith('[') ? 'string' : 'plain string';
    return `${kind} ${JSON.stringify(value)}`;
  }

  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

export function getUniqueStringValues(values: unknown[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)),
  ].sort();
}

function getUniqueOrderedStringValues(values: unknown[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)),
  ];
}

export function summarizeBasePdf(
  basePdf: unknown,
  templateDir: string | undefined,
): ValidationInspection['basePdf'] {
  if (typeof basePdf === 'string') {
    if (basePdf.startsWith('data:')) {
      return { kind: 'dataUri' };
    }

    if (basePdf.endsWith('.pdf')) {
      return {
        kind: 'pdfPath',
        path: basePdf,
        resolvedPath: templateDir ? resolve(templateDir, basePdf) : resolve(basePdf),
      };
    }

    return { kind: 'string' };
  }

  if (basePdf && typeof basePdf === 'object') {
    if ('width' in basePdf && 'height' in basePdf) {
      const width =
        typeof (basePdf as { width?: unknown }).width === 'number'
          ? (basePdf as { width: number }).width
          : undefined;
      const height =
        typeof (basePdf as { height?: unknown }).height === 'number'
          ? (basePdf as { height: number }).height
          : undefined;

      return {
        kind: 'blank',
        width,
        height,
        paperSize: width !== undefined && height !== undefined ? detectPaperSize(width, height) : null,
      };
    }

    return { kind: 'object' };
  }
  return { kind: 'missing' };
}
