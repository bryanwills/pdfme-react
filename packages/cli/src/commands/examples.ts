import { defineCommand } from 'citty';
import {
  assertNoUnknownFlags,
  fail,
  printJson,
  runWithContract,
} from '../contract.js';
import { writeOutput } from '../utils.js';
import {
  fetchExampleTemplateWithSource,
  getExampleManifest,
  getExamplesBaseUrl,
} from '../example-templates.js';
import { getOfficialExampleFonts } from '../example-fonts.js';

const examplesArgs = {
  name: { type: 'positional' as const, description: 'Template name to output', required: false },
  list: { type: 'boolean' as const, description: 'List available templates', default: false },
  output: { type: 'string' as const, alias: 'o', description: 'Output file path' },
  withInputs: {
    type: 'boolean' as const,
    alias: 'w',
    description: 'Output unified format with sample inputs',
    default: false,
  },
  latest: {
    type: 'boolean' as const,
    description: 'Fetch the latest manifest instead of the version-pinned manifest',
    default: false,
  },
  json: { type: 'boolean' as const, description: 'Machine-readable JSON output', default: false },
};

function generateSampleInputs(template: Record<string, unknown>): Record<string, string>[] {
  const schemas = template.schemas as Record<string, unknown>[][] | undefined;
  if (!Array.isArray(schemas) || schemas.length === 0) return [{}];

  const firstPage = schemas[0];
  const fields: Record<string, unknown>[] = Array.isArray(firstPage)
    ? (firstPage as Record<string, unknown>[])
    : typeof firstPage === 'object' && firstPage !== null
      ? Object.entries(firstPage).map(([name, schema]) => ({
          ...(typeof schema === 'object' && schema !== null ? schema : {}),
          name,
        }))
      : [];

  if (fields.length === 0) return [{}];

  const input: Record<string, string> = {};
  for (const schema of fields) {
    if (typeof schema !== 'object' || schema === null) continue;
    const name = schema.name as string;
    const content = schema.content as string | undefined;
    const readOnly = schema.readOnly as boolean | undefined;

    if (readOnly) continue;
    if (name) {
      input[name] = content || `Sample ${name}`;
    }
  }

  return [input];
}

export default defineCommand({
  meta: {
    name: 'examples',
    description: 'List and output example pdfme templates',
  },
  args: examplesArgs,
  async run({ args, rawArgs }) {
    return runWithContract({ json: Boolean(args.json) }, async () => {
      assertNoUnknownFlags(rawArgs, examplesArgs);

      let manifestResult;
      try {
        manifestResult = await getExampleManifest({ latest: args.latest });
      } catch (error) {
        fail(
          `Failed to load examples manifest. ${error instanceof Error ? error.message : String(error)}`,
          {
            code: 'EIO',
            exitCode: 3,
            cause: error,
          },
        );
      }

      const templateEntries = manifestResult.manifest.templates;
      const templateNames = templateEntries
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
        .sort();

      if (args.list || !args.name) {
        if (args.json) {
          printJson({
            ok: true,
            source: manifestResult.source,
            baseUrl: getExamplesBaseUrl(),
            manifest: manifestResult.manifest,
          });
        } else {
          console.log('Available templates:');
          for (const name of templateNames) {
            console.log(`  ${name}`);
          }
        }
        return;
      }

      const entry = templateEntries.find((template) => template.name === args.name);
      if (!entry) {
        fail(`Template "${args.name}" not found. Available templates: ${templateNames.join(', ')}`, {
          code: 'EARG',
          exitCode: 1,
        });
      }

      let templateResult;
      try {
        templateResult = await fetchExampleTemplateWithSource(args.name, {
          latest: args.latest,
          manifest: manifestResult.manifest,
        });
      } catch (error) {
        fail(
          `Failed to load example template "${args.name}". ${error instanceof Error ? error.message : String(error)}`,
          {
            code: 'EIO',
            exitCode: 3,
            cause: error,
          },
        );
      }

      const output = args.withInputs ? buildExampleJob(templateResult.template) : templateResult.template;

      if (args.output) {
        writeOutput(args.output, new TextEncoder().encode(JSON.stringify(output, null, 2)));

        if (args.json) {
          printJson({
            ok: true,
            name: args.name,
            source: templateResult.source,
            outputPath: args.output,
            mode: args.withInputs ? 'job' : 'template',
          });
        } else {
          const label = args.withInputs ? 'Job file' : 'Template';
          console.log(`\u2713 ${label} written to ${args.output}`);
        }
        return;
      }

      if (args.json) {
        printJson({
          ok: true,
          name: args.name,
          source: templateResult.source,
          mode: args.withInputs ? 'job' : 'template',
          data: output,
        });
      } else {
        console.log(JSON.stringify(output, null, 2));
      }
    });
  },
});

function buildExampleJob(template: Record<string, unknown>): Record<string, unknown> {
  const job: Record<string, unknown> = {
    template,
    inputs: generateSampleInputs(template),
  };

  const font = getOfficialExampleFonts(template);
  if (font) {
    job.options = { font };
  }

  return job;
}
