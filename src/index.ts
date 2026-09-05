import {parse, type Node} from 'acorn';
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

export interface TurboWarpExtensionMetadata {
  id: string;
  name: string;
  description: string;
  author: string;
  license: string;
}

export type TurboWarpExtensionHeader =
  | false
  | string
  | ((metadata: TurboWarpExtensionMetadata) => string);

export type TurboWarpExtensionRegistrations =
  | number
  | {min?: number; max?: number};

export interface TurboWarpExtensionOptions extends TurboWarpExtensionMetadata {
  fileName: string;
  entry?: string;
  target?: string;
  registrations?: TurboWarpExtensionRegistrations;
  header?: TurboWarpExtensionHeader;
  prelude?: string;
  minify?: boolean;
}

interface RegistrationRange {
  min: number;
  max: number;
}

type AstNode = Node & Record<string, unknown>;

const METADATA_KEYS = [
  'id',
  'name',
  'description',
  'author',
  'license'
] as const satisfies ReadonlyArray<keyof TurboWarpExtensionMetadata>;

const MODULE_SYNTAX_NODE_TYPES = new Set([
  'ExportAllDeclaration',
  'ExportDefaultDeclaration',
  'ExportNamedDeclaration',
  'ImportDeclaration',
  'ImportExpression'
]);

export function turboWarpExtension(options: TurboWarpExtensionOptions): Plugin {
  validateOptions(options);

  return {
    name: 'vite-plugin-turbowarp-extension',
    apply: 'build',

    config(userConfig: UserConfig): UserConfig {
      return {
        build: {
          target: options.target ?? 'es2020',
          minify: options.minify ?? userConfig.build?.minify ?? false,
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
      const fail = this.error.bind(this);
      const chunk = getOnlyJavaScriptChunk(bundle, fail);
      validateBundleCode(chunk.code, fail, options.registrations);

      if (options.prelude !== undefined) {
        validatePreludeCode(options.prelude, fail);
      }

      chunk.fileName = options.fileName;
      chunk.code = createTurboWarpBundle(options, chunk.code);
    }
  };
}

export function createTurboWarpBundle(
  options: TurboWarpExtensionOptions,
  source: string
): string {
  validateOptions(options);

  const sections = [
    createHeader(options),
    options.prelude ?? '',
    wrapExtensionSource(source)
  ];

  return `${joinSections(sections)}\n`;
}

export function validateBundleCode(
  source: string,
  fail: (message: string) => never = defaultFailure,
  expected: TurboWarpExtensionRegistrations = 1
): void {
  const range = resolveRegistrations(expected);

  let ast: Node;
  try {
    ast = parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module'
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`The generated TurboWarp extension is not valid JavaScript: ${detail}`);
  }

  let containsModuleSyntax = false;
  let registrationCount = 0;

  walkAst(ast, (node) => {
    if (
      MODULE_SYNTAX_NODE_TYPES.has(node.type) ||
      (node.type === 'MetaProperty' && isIdentifier(node.meta, 'import'))
    ) {
      containsModuleSyntax = true;
    }

    if (isScratchRegistrationCall(node)) {
      registrationCount += 1;
    }
  });

  if (containsModuleSyntax) {
    fail('The generated TurboWarp extension must not contain import or export statements.');
  }

  if (registrationCount < range.min || registrationCount > range.max) {
    fail(
      `Expected ${describeRegistrations(range)}, but found ${registrationCount}.`
    );
  }
}

function validatePreludeCode(
  source: string,
  fail: (message: string) => never
): void {
  if (source.trim() === '') {
    return;
  }

  // The prelude is a vendored script that runs outside the IIFE, so it is
  // parsed in sloppy mode. Script parsing already rejects import and export
  // declarations; only dynamic imports need an explicit check.
  let ast: Node;
  try {
    ast = parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'script'
    });
  } catch (error) {
    if (parsesAsModule(source)) {
      fail('The TurboWarp extension prelude must not contain import or export statements.');
    }

    const detail = error instanceof Error ? error.message : String(error);
    fail(
      `The TurboWarp extension prelude is not valid sloppy-mode JavaScript: ${detail}`
    );
  }

  if (!source.includes('import')) {
    return;
  }

  let containsModuleSyntax = false;
  walkAst(ast, (node) => {
    if (MODULE_SYNTAX_NODE_TYPES.has(node.type)) {
      containsModuleSyntax = true;
    }
  });

  if (containsModuleSyntax) {
    fail('The TurboWarp extension prelude must not contain import or export statements.');
  }
}

function parsesAsModule(source: string): boolean {
  try {
    parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module'
    });
    return true;
  } catch {
    return false;
  }
}

function createHeader(options: TurboWarpExtensionOptions): string {
  const header = options.header;

  if (header === false) {
    return '';
  }

  if (typeof header === 'string') {
    return header;
  }

  if (typeof header === 'function') {
    const result = header(createMetadata(options));
    if (typeof result !== 'string') {
      throw new TypeError(
        'TurboWarp extension option "header" must return a string when it is a function.'
      );
    }
    return result;
  }

  return [
    `// Name: ${options.name}`,
    `// ID: ${options.id}`,
    `// Description: ${options.description}`,
    `// By: ${options.author}`,
    `// License: ${options.license}`
  ].join('\n');
}

function createMetadata(
  options: TurboWarpExtensionOptions
): TurboWarpExtensionMetadata {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    author: options.author,
    license: options.license
  };
}

function wrapExtensionSource(source: string): string {
  return `(function (Scratch) {\n  'use strict';\n\n${indent(source.trim(), 2)}\n\n})(Scratch);`;
}

function joinSections(sections: string[]): string {
  return sections
    .map((section) => section.replace(/\s+$/, ''))
    .filter((section) => section.length > 0)
    .join('\n\n');
}

function resolveRegistrations(
  expected: TurboWarpExtensionRegistrations
): RegistrationRange {
  if (typeof expected === 'number') {
    assertRegistrationCount(expected, 'registrations');
    return {min: expected, max: expected};
  }

  if (
    typeof expected !== 'object' ||
    expected === null ||
    Array.isArray(expected)
  ) {
    throw new TypeError(
      'TurboWarp extension option "registrations" must be a number or a {min, max} object.'
    );
  }

  const min = expected.min ?? 1;
  const max = expected.max ?? Number.POSITIVE_INFINITY;

  assertRegistrationCount(min, 'registrations.min');
  if (max !== Number.POSITIVE_INFINITY) {
    assertRegistrationCount(max, 'registrations.max');
  }

  if (min > max) {
    throw new TypeError(
      'TurboWarp extension option "registrations.min" must not be greater than "registrations.max".'
    );
  }

  return {min, max};
}

function assertRegistrationCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `TurboWarp extension option "${label}" must be an integer of 1 or more.`
    );
  }
}

function describeRegistrations(range: RegistrationRange): string {
  const call = (count: number): string =>
    count === 1
      ? 'Scratch.extensions.register(...) call'
      : 'Scratch.extensions.register(...) calls';

  if (range.min === range.max) {
    const amount = range.min === 1 ? 'exactly one' : `exactly ${range.min}`;
    return `${amount} ${call(range.min)}`;
  }

  if (range.max === Number.POSITIVE_INFINITY) {
    const amount = range.min === 1 ? 'at least one' : `at least ${range.min}`;
    return `${amount} ${call(2)}`;
  }

  return `between ${range.min} and ${range.max} ${call(2)}`;
}

function validateOptions(options: TurboWarpExtensionOptions): void {
  const required: Array<keyof TurboWarpExtensionOptions> = [
    ...METADATA_KEYS,
    'fileName'
  ];

  for (const key of required) {
    const value = options[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`TurboWarp extension option "${key}" must be a non-empty string.`);
    }
    if (/[\r\n]/.test(value)) {
      throw new TypeError(`TurboWarp extension option "${key}" must be a single-line string.`);
    }
  }

  if (!/^[a-z0-9]+$/.test(options.id)) {
    throw new TypeError(
      'TurboWarp extension option "id" must contain only lowercase letters and numbers.'
    );
  }

  if (!options.fileName.endsWith('.js')) {
    throw new TypeError('TurboWarp extension option "fileName" must end with .js.');
  }

  if (options.registrations !== undefined) {
    resolveRegistrations(options.registrations);
  }

  if (
    options.header !== undefined &&
    options.header !== false &&
    typeof options.header !== 'string' &&
    typeof options.header !== 'function'
  ) {
    throw new TypeError(
      'TurboWarp extension option "header" must be false, a string, or a function.'
    );
  }

  if (options.prelude !== undefined && typeof options.prelude !== 'string') {
    throw new TypeError('TurboWarp extension option "prelude" must be a string.');
  }

  if (options.minify !== undefined && typeof options.minify !== 'boolean') {
    throw new TypeError('TurboWarp extension option "minify" must be a boolean.');
  }
}

function getOnlyJavaScriptChunk(
  bundle: OutputBundle,
  fail: (message: string) => never
): OutputChunk {
  const outputs = Object.values(bundle);
  const output = outputs[0];

  if (outputs.length !== 1 || !output || output.type !== 'chunk') {
    const files = outputs.map((item) => `${item.fileName} (${item.type})`).join(', ');
    fail(
      `Expected exactly one JavaScript output file, but found ${outputs.length}` +
        (files.length > 0 ? `: ${files}.` : '.')
    );
  }

  return output;
}

function walkAst(node: Node, visit: (node: AstNode) => void): void {
  const astNode = node as AstNode;
  visit(astNode);

  for (const value of Object.values(astNode)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          walkAst(item, visit);
        }
      }
    } else if (isNode(value)) {
      walkAst(value, visit);
    }
  }
}

function isScratchRegistrationCall(node: AstNode): boolean {
  if (node.type !== 'CallExpression' || !isMember(node.callee, 'register')) {
    return false;
  }

  return (
    isMember(node.callee.object, 'extensions') &&
    isIdentifier(node.callee.object.object, 'Scratch')
  );
}

function isMember(
  value: unknown,
  propertyName: string
): value is AstNode & {object: unknown} {
  return (
    isNode(value) &&
    value.type === 'MemberExpression' &&
    value.computed === false &&
    isIdentifier(value.property, propertyName)
  );
}

function isIdentifier(value: unknown, name: string): boolean {
  return isNode(value) && value.type === 'Identifier' && value.name === name;
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  );
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
