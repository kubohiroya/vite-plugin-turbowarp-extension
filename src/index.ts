import {parse, type Node} from 'acorn';
import type {Plugin, Rolldown, UserConfig} from 'vite';

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
  /** Optional descriptions keyed by language tag, emitted without running extension code. */
  descriptions?: Readonly<Record<string, string>>;
  author: string;
  license: string;
  /** Present only when the `unsandboxed` option is set. */
  unsandboxed?: TurboWarpUnsandboxedRequirement;
}

/**
 * Whether the user must check "Run without sandbox" in TurboWarp's extension security dialog:
 * `required` (the extension cannot work sandboxed), `optional` (it works with less) or
 * `not-needed`. Emitted as the `// Unsandboxed:` header line that sb3-toolchain reads.
 */
export type TurboWarpUnsandboxedRequirement = 'required' | 'optional' | 'not-needed';

export const UNSANDBOXED_REQUIREMENTS: readonly TurboWarpUnsandboxedRequirement[] =
  Object.freeze(['required', 'optional', 'not-needed']);

/**
 * Shown in the palette when the extension runs sandboxed although it declared `required` (it then
 * does not run) or `optional` (it runs with less). Kept identical to sb3-toolchain's
 * `defaultSandboxedNotices`, which bundles use for the same situation.
 */
export const DEFAULT_SANDBOXED_NOTICES: Readonly<
  Record<'required' | 'optional', Readonly<Record<string, string>>>
> = Object.freeze({
  required: Object.freeze({
    en:
      'This extension must run without the sandbox.\n' +
      'Load the project again and, in the extension\n' +
      'security dialog, check "Run without sandbox"\n' +
      'before allowing it.',
    ja:
      'この拡張機能はサンドボックスなしで実行する必要があります。\n' +
      'プロジェクトを開き直し、拡張機能セキュリティの画面で\n' +
      '「サンドボックスなしで実行する」にチェックを付けてから\n' +
      '許可してください。'
  }),
  optional: Object.freeze({
    en:
      'Running in the sandbox: some features are unavailable.\n' +
      'To use them, load the project again and check\n' +
      '"Run without sandbox" in the extension security dialog.',
    ja:
      'サンドボックス内で実行中のため、一部の機能が使えません。\n' +
      '使うには、プロジェクトを開き直し、拡張機能セキュリティの画面で\n' +
      '「サンドボックスなしで実行する」にチェックを付けてください。'
  })
});

export type TurboWarpExtensionHeader =
  | false
  | string
  | ((metadata: TurboWarpExtensionMetadata) => string);

export interface TurboWarpExtensionOptions extends TurboWarpExtensionMetadata {
  fileName: string;
  entry?: string;
  target?: string;
  header?: TurboWarpExtensionHeader;
  prelude?: string;
  minify?: boolean;
  unsandboxed?: TurboWarpUnsandboxedRequirement;
  sandboxedGuard?: boolean;
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
              codeSplitting: false
            }
          }
        }
      };
    },

    generateBundle(_outputOptions, bundle): void {
      const fail = this.error.bind(this);
      const chunk = getOnlyJavaScriptChunk(bundle, fail);
      validateBundleCode(chunk.code, fail);

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
    wrapExtensionSource(source, sandboxedGuardSource(options))
  ];

  return `${joinSections(sections)}\n`;
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
    `// License: ${options.license}`,
    ...(options.unsandboxed === undefined ? [] : [`// Unsandboxed: ${options.unsandboxed}`]),
    ...Object.entries(options.descriptions ?? {})
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'))
      .map(([locale, description]) => `// Description[${locale.toLowerCase()}]: ${description}`)
  ].join('\n');
}

function createMetadata(
  options: TurboWarpExtensionOptions
): TurboWarpExtensionMetadata {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    ...(options.descriptions === undefined ? {} : {descriptions: {...options.descriptions}}),
    author: options.author,
    license: options.license,
    ...(options.unsandboxed === undefined ? {} : {unsandboxed: options.unsandboxed})
  };
}

/**
 * The body is inserted as is. Indenting it would also indent the continuation lines of
 * template literals, which minifiers emit for every `"\n"`, and so change string values.
 */
function wrapExtensionSource(source: string, guard: string): string {
  const body = [guard, source.trim()].filter((section) => section.length > 0).join('\n\n');
  return `(function (Scratch) {\n  'use strict';\n\n${body}\n\n})(Scratch);`;
}

/**
 * Detects a sandboxed load (`Scratch.extensions.unsandboxed !== true`) for an extension that
 * declared `required` or `optional`, mirroring the guard sb3-toolchain generates for bundles.
 *
 * `required` registers a placeholder under the extension's own ID whose palette explains how to
 * reload unsandboxed, and returns before the entry runs: a sandboxed iframe that throws before
 * registering leaves TurboWarp waiting forever. `optional` lets the entry run and prefixes its
 * palette with the notice.
 *
 * Neither path spells `Scratch.extensions.register(`: the guard calls the function it read from
 * `Scratch.extensions`. The entry's own call therefore stays the only textual one, which
 * sb3-toolchain requires of bundle members, and at run time exactly one registration happens.
 */
function sandboxedGuardSource(options: TurboWarpExtensionOptions): string {
  if (options.sandboxedGuard !== true) {
    return '';
  }

  const required = options.unsandboxed === 'required';
  const notice = DEFAULT_SANDBOXED_NOTICES[required ? 'required' : 'optional'];
  const lines = [
    `const SANDBOXED_EXTENSION_ID = ${JSON.stringify(options.id)};`,
    `const SANDBOXED_EXTENSION_NAME = ${JSON.stringify(options.name)};`,
    `const SANDBOXED_NOTICE = ${JSON.stringify(notice)};`,
    'const SANDBOXED = !Scratch.extensions || Scratch.extensions.unsandboxed !== true;',
    'const sandboxedNoticeText = () => {',
    "  let locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';",
    '  try {',
    "    if (Scratch.translate && typeof Scratch.translate.language === 'string') {",
    '      locale = Scratch.translate.language;',
    '    }',
    '  } catch (_error) {',
    '    // Fall back to the browser language.',
    '  }',
    '  locale = String(locale).toLowerCase();',
    "  const language = locale.split('-')[0];",
    '  if (Object.prototype.hasOwnProperty.call(SANDBOXED_NOTICE, locale)) return SANDBOXED_NOTICE[locale];',
    '  if (Object.prototype.hasOwnProperty.call(SANDBOXED_NOTICE, language)) return SANDBOXED_NOTICE[language];',
    '  return SANDBOXED_NOTICE.en;',
    '};',
    "const sandboxedNoticeBlocks = () => ['⚠ ' + SANDBOXED_EXTENSION_NAME, ...sandboxedNoticeText().split('\\n')]",
    '  .filter((line) => line.length > 0)',
    '  .map((line) => ({',
    "    blockType: (Scratch.BlockType && Scratch.BlockType.LABEL) || 'label',",
    '    text: line',
    '  }));',
    'if (SANDBOXED) {',
    "  if (typeof console !== 'undefined') {",
    `    const report = console.${required ? 'error' : 'warn'} || console.log;`,
    `    report.call(console, '[' + SANDBOXED_EXTENSION_ID + '] ' + SANDBOXED_EXTENSION_NAME + ' ${
      required ? 'requires' : 'works better with'
    } unsandboxed loading. ' + sandboxedNoticeText().replace(/\\n/gu, ' '));`,
    '  }',
    '  const extensions = Scratch.extensions;',
    '  const register = extensions.register;'
  ];

  if (required) {
    lines.push(
      '  class SandboxedExtensionNotice {',
      '    getInfo() {',
      '      return {',
      '        id: SANDBOXED_EXTENSION_ID,',
      '        name: SANDBOXED_EXTENSION_NAME,',
      "        color1: '#D65C5C',",
      '        blocks: sandboxedNoticeBlocks(),',
      '        menus: {}',
      '      };',
      '    }',
      '  }',
      '  register.call(extensions, new SandboxedExtensionNotice());',
      '  return;',
      '}'
    );
  } else {
    lines.push(
      '  const noticeExtensions = Object.create(extensions);',
      "  Object.defineProperty(noticeExtensions, 'register', {",
      '    value: (extension) => {',
      "      const getInfo = extension.getInfo;",
      '      extension.getInfo = function (...args) {',
      '        const info = getInfo.apply(this, args);',
      '        return {...info, blocks: [...sandboxedNoticeBlocks(), ...(info.blocks || [])]};',
      '      };',
      '      return register.call(extensions, extension);',
      '    }',
      '  });',
      "  Scratch = Object.create(Scratch, {extensions: {value: noticeExtensions}});",
      '}'
    );
  }

  return lines.join('\n');
}

function joinSections(sections: string[]): string {
  return sections
    .map((section) => section.replace(/\s+$/, ''))
    .filter((section) => section.length > 0)
    .join('\n\n');
}

function validateOptions(options: TurboWarpExtensionOptions): void {
  if (options.descriptions !== undefined) {
    if (options.descriptions === null || typeof options.descriptions !== 'object' ||
      Array.isArray(options.descriptions)) {
      throw new TypeError('TurboWarp extension option "descriptions" must be a language-to-text record.');
    }
    const locales = new Set<string>();
    for (const [locale, description] of Object.entries(options.descriptions)) {
      if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(locale) || locales.has(locale.toLowerCase())) {
        throw new TypeError('TurboWarp extension option "descriptions" needs unique language tags.');
      }
      if (typeof description !== 'string' || description.trim() === '' ||
        /[\r\n\u2028\u2029]/.test(description)) {
        throw new TypeError('TurboWarp extension option "descriptions" needs non-empty single-line strings.');
      }
      locales.add(locale.toLowerCase());
    }
  }
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

  if (
    options.unsandboxed !== undefined &&
    !(UNSANDBOXED_REQUIREMENTS as readonly unknown[]).includes(options.unsandboxed)
  ) {
    throw new TypeError(
      `TurboWarp extension option "unsandboxed" must be one of ${UNSANDBOXED_REQUIREMENTS.map(
        (value) => JSON.stringify(value)
      ).join(', ')}, but got ${JSON.stringify(options.unsandboxed)}.`
    );
  }

  if (options.sandboxedGuard !== undefined && typeof options.sandboxedGuard !== 'boolean') {
    throw new TypeError('TurboWarp extension option "sandboxedGuard" must be a boolean.');
  }

  if (
    options.sandboxedGuard === true &&
    options.unsandboxed !== 'required' &&
    options.unsandboxed !== 'optional'
  ) {
    throw new TypeError(
      'TurboWarp extension option "sandboxedGuard" needs "unsandboxed" set to "required" or "optional".'
    );
  }
}

function getOnlyJavaScriptChunk(
  bundle: Rolldown.OutputBundle,
  fail: (message: string) => never
): Rolldown.OutputChunk {
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

function defaultFailure(message: string): never {
  throw new Error(message);
}
