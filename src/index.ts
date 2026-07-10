import type {OutputBundle, OutputChunk} from 'rollup';
import type {Plugin, UserConfig} from 'vite';

export {
  DEFAULT_BEGIN_MARKER,
  DEFAULT_END_MARKER,
  assertGeneratedBlockSectionCurrent,
  generateBlockDocumentationMarkdown,
  replaceGeneratedBlockSection,
  type BlockDocumentation,
  type BlockDocumentationEntry,
  type DocumentedBlockType,
  type ReadmeBlockSectionOptions
} from './readme.js';

export interface TurboWarpExtensionOptions {
  id: string;
  name: string;
  description: string;
  author: string;
  license: string;
  fileName: string;
  entry?: string;
  target?: string;
}

const MODULE_SYNTAX = /(^|\n)\s*(?:import|export)\s/m;
const REGISTER_CALL = /Scratch\.extensions\.register\s*\(/g;

export function turboWarpExtension(options: TurboWarpExtensionOptions): Plugin {
  validateOptions(options);

  return {
    name: 'vite-plugin-turbowarp-extension',
    apply: 'build',

    config(): UserConfig {
      return {
        build: {
          target: options.target ?? 'es2020',
          minify: false,
          sourcemap: false,
          emptyOutDir: true,
          lib: {
            entry: options.entry ?? 'src/index.ts',
            formats: ['es'],
            fileName: () => options.fileName
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true
            }
          }
        }
      };
    },

    generateBundle(_outputOptions, bundle): void {
      const chunk = getOnlyJavaScriptChunk(bundle, this.error.bind(this));
      validateBundleCode(chunk.code, this.error.bind(this));

      chunk.fileName = options.fileName;
      chunk.code = createTurboWarpBundle(options, chunk.code);
    }
  };
}

export function createTurboWarpBundle(
  options: TurboWarpExtensionOptions,
  source: string
): string {
  const metadata = [
    `// Name: ${options.name}`,
    `// ID: ${options.id}`,
    `// Description: ${options.description}`,
    `// By: ${options.author}`,
    `// License: ${options.license}`
  ].join('\n');

  return `${metadata}\n\n(function (Scratch) {\n  'use strict';\n\n${indent(source.trim(), 2)}\n\n})(Scratch);\n`;
}

export function validateBundleCode(
  source: string,
  fail: (message: string) => never = defaultFailure
): void {
  if (MODULE_SYNTAX.test(source)) {
    fail('The generated TurboWarp extension must not contain import or export statements.');
  }

  const registrationCount = source.match(REGISTER_CALL)?.length ?? 0;
  if (registrationCount !== 1) {
    fail(
      `Expected exactly one Scratch.extensions.register(...) call, but found ${registrationCount}.`
    );
  }
}

function validateOptions(options: TurboWarpExtensionOptions): void {
  const required: Array<keyof TurboWarpExtensionOptions> = [
    'id',
    'name',
    'description',
    'author',
    'license',
    'fileName'
  ];

  for (const key of required) {
    const value = options[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`TurboWarp extension option "${key}" must be a non-empty string.`);
    }
  }

  if (!options.fileName.endsWith('.js')) {
    throw new TypeError('TurboWarp extension option "fileName" must end with .js.');
  }
}

function getOnlyJavaScriptChunk(
  bundle: OutputBundle,
  fail: (message: string) => never
): OutputChunk {
  const chunks = Object.values(bundle).filter(
    (item): item is OutputChunk => item.type === 'chunk'
  );

  if (chunks.length !== 1) {
    fail(`Expected exactly one JavaScript chunk, but found ${chunks.length}.`);
  }

  const chunk = chunks[0];
  if (!chunk) {
    fail('The JavaScript output chunk was not found.');
  }

  return chunk;
}

function indent(source: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return source
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

function defaultFailure(message: string): never {
  throw new Error(message);
}
