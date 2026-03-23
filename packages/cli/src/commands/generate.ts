import { defineCommand } from 'citty';
import { generate } from '@pdfme/generator';
import { pdf2img, pdf2size } from '@pdfme/converter';
import { checkGenerateProps, isBlankPdf } from '@pdfme/common';
import type { Template } from '@pdfme/common';
import * as schemas from '@pdfme/schemas';
import {
  assertNoUnknownFlags,
  fail,
  parseEnumArg,
  parsePositiveNumberArg,
  printJson,
  runWithContract,
} from '../contract.js';
import {
  ensureSafeDefaultOutputPath,
  getImageOutputPaths,
  loadInput,
  resolveBasePdf,
  writeOutput,
} from '../utils.js';
import { resolveFont } from '../fonts.js';
import { detectCJKInTemplate, detectCJKInInputs } from '../cjk-detect.js';
import { drawGridOnImage } from '../grid.js';

const allPlugins = {
  text: schemas.text,
  multiVariableText: schemas.multiVariableText,
  image: schemas.image,
  svg: schemas.svg,
  table: schemas.table,
  ...schemas.barcodes,
  line: schemas.line,
  rectangle: schemas.rectangle,
  ellipse: schemas.ellipse,
  dateTime: schemas.dateTime,
  date: schemas.date,
  time: schemas.time,
  select: schemas.select,
  radioGroup: schemas.radioGroup,
  checkbox: schemas.checkbox,
  ...('signature' in schemas ? { signature: (schemas as Record<string, unknown>).signature } : {}),
};

const generateArgs = {
  file: {
    type: 'positional' as const,
    description: 'Unified JSON file: { template, inputs }',
    required: false,
  },
  template: { type: 'string' as const, alias: 't', description: 'Template JSON file' },
  inputs: { type: 'string' as const, alias: 'i', description: 'Input data JSON file' },
  output: { type: 'string' as const, alias: 'o', description: 'Output PDF path', default: 'output.pdf' },
  force: {
    type: 'boolean' as const,
    description: 'Allow overwriting the implicit default output path',
    default: false,
  },
  image: { type: 'boolean' as const, description: 'Also output PNG images per page', default: false },
  imageFormat: { type: 'string' as const, description: 'Image format: png | jpeg', default: 'png' },
  scale: { type: 'string' as const, description: 'Image render scale', default: '1' },
  grid: {
    type: 'boolean' as const,
    description: 'Overlay grid + schema boundaries on images',
    default: false,
  },
  gridSize: { type: 'string' as const, description: 'Grid spacing in mm', default: '10' },
  font: {
    type: 'string' as const,
    description: 'Custom font(s): name=path (comma-separated for multiple)',
  },
  basePdf: { type: 'string' as const, description: 'Override basePdf with PDF file path' },
  noAutoFont: {
    type: 'boolean' as const,
    description: 'Disable automatic CJK font download',
    default: false,
  },
  verbose: { type: 'boolean' as const, alias: 'v', description: 'Verbose output', default: false },
  json: { type: 'boolean' as const, description: 'Machine-readable JSON output', default: false },
};

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Generate PDF from template and inputs',
  },
  args: generateArgs,
  async run({ args, rawArgs }) {
    return runWithContract({ json: Boolean(args.json) }, async () => {
      assertNoUnknownFlags(rawArgs, generateArgs);

      const imageFormat = parseEnumArg('imageFormat', args.imageFormat, ['png', 'jpeg']);
      const scale = parsePositiveNumberArg('scale', args.scale);
      const gridSize = parsePositiveNumberArg('gridSize', args.gridSize);

      ensureSafeDefaultOutputPath({
        filePath: args.output,
        rawArgs,
        optionName: 'output',
        optionAlias: 'o',
        defaultValue: 'output.pdf',
        force: Boolean(args.force),
      });

      const { template: rawTemplate, inputs, templateDir } = loadInput({
        _: args.file ? [args.file] : [],
        template: args.template,
        inputs: args.inputs,
      });

      const template = resolveBasePdf(rawTemplate, args.basePdf, templateDir) as unknown as Template;

      try {
        checkGenerateProps({ template, inputs });
      } catch (error) {
        fail(`Invalid generation input. ${error instanceof Error ? error.message : String(error)}`, {
          code: 'EVALIDATE',
          exitCode: 1,
          cause: error,
        });
      }

      const fontArgs = args.font
        ? args.font
            .split(',')
            .map((value: string) => value.trim())
            .filter(Boolean)
        : undefined;

      const hasCJK = detectCJKInTemplate(template as any) || detectCJKInInputs(inputs);
      const font = await resolveFont(fontArgs, hasCJK, args.noAutoFont, args.verbose);

      if (args.verbose) {
        console.error(`Template: ${template.schemas?.length ?? 0} page(s)`);
        console.error(`Inputs: ${inputs.length} set(s)`);
        console.error(`Fonts: ${Object.keys(font).join(', ')}`);
      }

      const pdf = await generate({
        template,
        inputs,
        options: { font },
        plugins: allPlugins as Record<string, any>,
      });

      writeOutput(args.output, pdf);

      const result: Record<string, unknown> = {
        pdf: args.output,
        size: pdf.byteLength,
      };

      if (args.image || args.grid) {
        const images = await pdf2img(pdf, { scale, imageType: imageFormat });
        const imagePaths = getImageOutputPaths(args.output, images.length, imageFormat);
        result.pages = images.length;

        let pageSizes: Array<{ width: number; height: number }> | null = null;

        if (args.grid) {
          if (isBlankPdf(template.basePdf)) {
            const bpdf = template.basePdf as { width: number; height: number };
            pageSizes = images.map(() => ({ width: bpdf.width, height: bpdf.height }));
          } else {
            pageSizes = await pdf2size(pdf);
          }

          for (let i = 0; i < images.length; i++) {
            const templateSchemas = template.schemas ?? [];
            const templatePageIndex = i % templateSchemas.length;
            const pageSchemas = (templateSchemas[templatePageIndex] ?? []) as Array<{
              name: string;
              type: string;
              position: { x: number; y: number };
              width: number;
              height: number;
            }>;

            const size = pageSizes[i] ?? pageSizes[0] ?? { width: 210, height: 297 };

            const gridImage = await drawGridOnImage(
              images[i],
              pageSchemas,
              gridSize,
              size.width,
              size.height,
              imageFormat,
            );
            writeOutput(imagePaths[i], gridImage);
          }
        } else {
          for (let i = 0; i < images.length; i++) {
            writeOutput(imagePaths[i], images[i]);
          }
        }

        result.images = imagePaths;
      } else {
        result.pages = template.schemas?.length ? inputs.length * template.schemas.length : 0;
      }

      if (args.json) {
        printJson({ ok: true, ...result });
      } else {
        console.log(`\u2713 PDF: ${args.output} (${formatBytes(pdf.byteLength)})`);
        if (result.images) {
          for (const img of result.images as string[]) {
            console.log(`\u2713 Image: ${img}`);
          }
        }
      }
    });
  },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
