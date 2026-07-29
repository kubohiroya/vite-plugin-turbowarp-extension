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

type AstNode = Node & Record<string, unknown>;

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
  validateOptions(options);

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
