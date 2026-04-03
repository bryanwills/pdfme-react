interface CliErrorOptions {
  code?: string;
  exitCode?: number;
  details?: unknown;
  cause?: unknown;
}

export interface CliArgDefinition {
  type: 'positional' | 'string' | 'boolean';
  alias?: string | string[];
  description?: string;
  required?: boolean;
  default?: unknown;
}

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.code = options.code ?? 'ECLI';
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause as Error;
    }
  }
}

export function fail(message: string, options: CliErrorOptions = {}): never {
  throw new CliError(message, options);
}

export function printJson(value: Record<string, unknown>): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function runWithContract<T>(
  options: { json: boolean },
  task: () => Promise<T> | T,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    return handleCommandError(error, options.json);
  }
}

export function handleCommandError(error: unknown, json: boolean): never {
  const normalized = normalizeCliError(error);

  if (json) {
    const payload: Record<string, unknown> = {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
      },
    };

    if (normalized.details !== undefined) {
      (payload.error as Record<string, unknown>).details = normalized.details;
    }

    printJson(payload);
  } else {
    console.error(`Error: ${normalized.message}`);
  }

  process.exit(normalized.exitCode);
}

export function assertNoUnknownFlags(
  rawArgs: string[],
  argsDefinition: Record<string, CliArgDefinition>,
): void {
  const booleanFlags = new Set<string>();
  const valueFlags = new Set<string>();
  const negatedBooleanFlags = new Set<string>();

  for (const [name, definition] of Object.entries(argsDefinition)) {
    if (definition.type === 'positional') continue;

    for (const flag of getFlagVariants(name, definition.alias)) {
      if (definition.type === 'boolean') {
        booleanFlags.add(flag);
        if (flag.startsWith('--') && !name.startsWith('no')) {
          negatedBooleanFlags.add(`--no-${flag.slice(2)}`);
        }
      } else {
        valueFlags.add(flag);
      }
    }
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];

    if (token === '--') break;
    if (!token.startsWith('-') || token === '-') continue;

    const [flag, inlineValue] = splitFlagToken(token);

    if (booleanFlags.has(flag) || negatedBooleanFlags.has(flag)) {
      if (inlineValue !== undefined) {
        fail(`Boolean flag ${flag} does not take a value.`, {
          code: 'EARG',
          exitCode: 1,
        });
      }
      continue;
    }

    if (valueFlags.has(flag)) {
      if (inlineValue !== undefined) {
        if (inlineValue.length === 0) {
          fail(`Missing value for argument ${flag}.`, { code: 'EARG', exitCode: 1 });
        }
      } else {
        const next = rawArgs[i + 1];
        if (!next || next === '--' || next.startsWith('-')) {
          fail(`Missing value for argument ${flag}.`, { code: 'EARG', exitCode: 1 });
        }
        i++;
      }
      continue;
    }

    fail(`Unknown argument: ${flag}`, { code: 'EARG', exitCode: 1 });
  }
}

export function isOptionProvided(
  rawArgs: string[],
  name: string,
  alias?: string | string[],
): boolean {
  const allowedFlags = new Set(getFlagVariants(name, alias));
  return rawArgs.some((token) => {
    if (!token.startsWith('-') || token === '-') return false;
    const [flag] = splitFlagToken(token);
    return allowedFlags.has(flag);
  });
}

export function parseEnumArg<T extends string>(
  optionName: string,
  value: unknown,
  allowedValues: readonly T[],
): T {
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    fail(
      `Invalid value for --${optionName}: expected one of ${allowedValues.join(', ')}, received ${formatValue(value)}.`,
      { code: 'EARG', exitCode: 1 },
    );
  }

  return value as T;
}

export function parsePositiveNumberArg(optionName: string, value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(
      `Invalid value for --${optionName}: expected a positive number, received ${formatValue(value)}.`,
      { code: 'EARG', exitCode: 1 },
    );
  }

  return parsed;
}

function normalizeCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof Error) {
    const errorCode =
      typeof (error as NodeJS.ErrnoException).code === 'string'
        ? (error as NodeJS.ErrnoException).code
        : undefined;

    if (errorCode && errorCode.startsWith('E')) {
      return new CliError(error.message, {
        code: 'EIO',
        exitCode: 3,
        details: { errno: errorCode },
        cause: error,
      });
    }

    return new CliError(error.message, {
      code: 'ERUNTIME',
      exitCode: 2,
      cause: error,
    });
  }

  return new CliError(String(error), {
    code: 'ERUNTIME',
    exitCode: 2,
  });
}

function splitFlagToken(token: string): [string, string | undefined] {
  const eqIndex = token.indexOf('=');
  if (eqIndex === -1) {
    return [token, undefined];
  }

  return [token.slice(0, eqIndex), token.slice(eqIndex + 1)];
}

function getFlagVariants(name: string, alias?: string | string[]): string[] {
  const flags = new Set<string>();

  addFlagVariants(flags, name);

  for (const item of toArray(alias)) {
    addFlagVariants(flags, item);
  }

  return [...flags];
}

function addFlagVariants(flags: Set<string>, value: string): void {
  if (value.length === 1) {
    flags.add(`-${value}`);
    return;
  }

  flags.add(`--${value}`);
  flags.add(`--${toKebabCase(value)}`);
  flags.add(`--${toCamelCase(value)}`);
}

function toArray(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function toCamelCase(value: string): string {
  return value.replace(/[-_ ]+([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase());
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  return String(value);
}
