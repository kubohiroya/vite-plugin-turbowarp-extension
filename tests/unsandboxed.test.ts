import {runInNewContext} from 'node:vm';
import {describe, expect, it} from 'vitest';
import {
  DEFAULT_SANDBOXED_NOTICES,
  createTurboWarpBundle,
  turboWarpExtension,
  type TurboWarpExtensionMetadata,
  type TurboWarpExtensionOptions
} from '../src/index.js';

const options: TurboWarpExtensionOptions = {
  id: 'exampleextension',
  name: 'Example Extension',
  description: 'An example extension.',
  author: 'Example Author',
  license: 'MPL-2.0',
  fileName: 'example-extension.js'
};

const entry = [
  'class ExampleExtension {',
  "  getInfo() { return {id: 'exampleextension', name: 'Example Extension', blocks: [{opcode: 'hello', blockType: 'command', text: 'hello'}]}; }",
  '}',
  'globalThis.entryRan = true;',
  'Scratch.extensions.register(new ExampleExtension());'
].join('\n');

const REGISTER_PATTERN = /\bScratch\s*\.\s*extensions\s*\.\s*register\s*\(/gu;

interface LoadResult {
  registered: Array<{getInfo(): {id: string; name: string; blocks: Array<{text: string; blockType: string}>}}>;
  entryRan: boolean;
  errors: string[];
  warnings: string[];
}

function load(
  code: string,
  {unsandboxed, language}: {unsandboxed: boolean; language?: string}
): LoadResult {
  const registered: LoadResult['registered'] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const context: Record<string, unknown> = {
    console: {
      error: (message: string) => errors.push(message),
      warn: (message: string) => warnings.push(message),
      log: () => undefined
    },
    Scratch: {
      BlockType: {LABEL: 'label', COMMAND: 'command'},
      translate: language === undefined ? undefined : {language},
      extensions: {
        unsandboxed,
        register(extension: LoadResult['registered'][number]) {
          registered.push(extension);
        }
      }
    }
  };
  runInNewContext(code, context);
  return {registered, entryRan: context.entryRan === true, errors, warnings};
}

describe('unsandboxed header', () => {
  it.each(['required', 'optional', 'not-needed'] as const)(
    'emits // Unsandboxed: %s right after // License:',
    (unsandboxed) => {
      const result = createTurboWarpBundle({...options, unsandboxed}, entry);

      expect(result.startsWith(
        [
          '// Name: Example Extension',
          '// ID: exampleextension',
          '// Description: An example extension.',
          '// By: Example Author',
          '// License: MPL-2.0',
          `// Unsandboxed: ${unsandboxed}`,
          '',
          '(function (Scratch) {'
        ].join('\n')
      )).toBe(true);
    }
  );

  it('leaves the output byte-identical when the option is omitted', () => {
    const withoutOption = createTurboWarpBundle(options, entry);
    const withUndefined = createTurboWarpBundle({...options, unsandboxed: undefined} as unknown as TurboWarpExtensionOptions, entry);

    expect(withUndefined).toBe(withoutOption);
    expect(withoutOption).not.toContain('Unsandboxed');
    expect(withoutOption).toBe(
      [
        '// Name: Example Extension',
        '// ID: exampleextension',
        '// Description: An example extension.',
        '// By: Example Author',
        '// License: MPL-2.0',
        '',
        '(function (Scratch) {',
        "  'use strict';",
        '',
        entry,
        '',
        '})(Scratch);',
        ''
      ].join('\n')
    );
  });

  it('adds no guard unless sandboxedGuard is set', () => {
    const header = createTurboWarpBundle({...options, unsandboxed: 'required'}, entry);

    expect(header).not.toContain('SANDBOXED');
  });

  it('passes the requirement to a header callback only when it is set', () => {
    const received: TurboWarpExtensionMetadata[] = [];
    const header = (metadata: TurboWarpExtensionMetadata) => {
      received.push(metadata);
      return '// custom';
    };
    createTurboWarpBundle({...options, header}, entry);
    createTurboWarpBundle({...options, header, unsandboxed: 'optional'}, entry);

    expect('unsandboxed' in received[0]!).toBe(false);
    expect(received[1]?.unsandboxed).toBe('optional');
  });

  it('rejects any other value at config time', () => {
    for (const value of ['Required', 'yes', '', true, 1]) {
      expect(() =>
        turboWarpExtension({
          ...options,
          unsandboxed: value as 'required'
        })
      ).toThrow(/"unsandboxed" must be one of "required", "optional", "not-needed"/);
    }
  });

  it('rejects a guard without a required or optional declaration', () => {
    expect(() => turboWarpExtension({...options, sandboxedGuard: true})).toThrow(
      /"sandboxedGuard" needs "unsandboxed"/
    );
    expect(() =>
      turboWarpExtension({...options, unsandboxed: 'not-needed', sandboxedGuard: true})
    ).toThrow(/"sandboxedGuard" needs "unsandboxed"/);
    expect(() =>
      turboWarpExtension({
        ...options,
        unsandboxed: 'required',
        sandboxedGuard: 'yes' as unknown as boolean
      })
    ).toThrow(/"sandboxedGuard" must be a boolean/);
  });
});

describe('sandboxed guard', () => {
  const build = (unsandboxed: 'required' | 'optional') =>
    createTurboWarpBundle({...options, unsandboxed, sandboxedGuard: true}, entry);

  it.each(['required', 'optional'] as const)(
    'keeps the header first and one textual register call (%s)',
    (unsandboxed) => {
      const code = build(unsandboxed);

      expect(code.startsWith('// Name: Example Extension\n')).toBe(true);
      expect(code).toContain(`// Unsandboxed: ${unsandboxed}\n\n(function (Scratch) {`);
      expect(code.match(REGISTER_PATTERN)).toHaveLength(1);
    }
  );

  it.each(['required', 'optional'] as const)(
    'runs the entry untouched when loaded unsandboxed (%s)',
    (unsandboxed) => {
      const result = load(build(unsandboxed), {unsandboxed: true});

      expect(result.entryRan).toBe(true);
      expect(result.registered).toHaveLength(1);
      expect(result.registered[0]!.getInfo().blocks.map((block) => block.text)).toEqual([
        'hello'
      ]);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  );

  it('registers a placeholder instead of the entry when required and sandboxed', () => {
    const result = load(build('required'), {unsandboxed: false});

    expect(result.entryRan).toBe(false);
    expect(result.registered).toHaveLength(1);
    const info = result.registered[0]!.getInfo();
    expect(info.id).toBe('exampleextension');
    expect(info.name).toBe('Example Extension');
    expect(info.blocks.every((block) => block.blockType === 'label')).toBe(true);
    expect(info.blocks.map((block) => block.text)).toEqual([
      '⚠ Example Extension',
      ...DEFAULT_SANDBOXED_NOTICES.required.en!.split('\n')
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(
      /^\[exampleextension\] Example Extension requires unsandboxed loading\. This extension must run/
    );
  });

  it('treats a missing unsandboxed flag as sandboxed', () => {
    const result = load(build('required'), {unsandboxed: undefined as unknown as boolean});

    expect(result.entryRan).toBe(false);
  });

  it('localizes the notice by Scratch.translate.language and its primary subtag', () => {
    const ja = load(build('required'), {unsandboxed: false, language: 'ja-Hira'});
    const fallback = load(build('required'), {unsandboxed: false, language: 'fr'});

    expect(ja.registered[0]!.getInfo().blocks.map((block) => block.text).slice(1)).toEqual(
      DEFAULT_SANDBOXED_NOTICES.required.ja!.split('\n')
    );
    expect(fallback.registered[0]!.getInfo().blocks[1]!.text).toBe(
      'This extension must run without the sandbox.'
    );
  });

  it('runs the entry with a notice prefixed to its palette when optional and sandboxed', () => {
    const result = load(build('optional'), {unsandboxed: false, language: 'ja'});

    expect(result.entryRan).toBe(true);
    expect(result.registered).toHaveLength(1);
    const info = result.registered[0]!.getInfo();
    expect(info.id).toBe('exampleextension');
    expect(info.blocks.map((block) => block.text)).toEqual([
      '⚠ Example Extension',
      ...DEFAULT_SANDBOXED_NOTICES.optional.ja!.split('\n'),
      'hello'
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/works better with unsandboxed loading/);
  });

  it('registers once through an sb3-toolchain style member Scratch', () => {
    // sb3-toolchain runs each bundle member with a Scratch whose extensions.register is replaced.
    const code = build('optional');
    const body = code.slice(code.indexOf('(function (Scratch) {'));
    const captured: unknown[] = [];
    const base = {
      BlockType: {LABEL: 'label'},
      extensions: {unsandboxed: false, register: () => undefined}
    };
    const extensions = Object.create(base.extensions);
    Object.defineProperty(extensions, 'register', {value: (extension: unknown) => captured.push(extension)});
    const member = new Proxy(base, {
      get: (target, property) =>
        property === 'extensions' ? extensions : Reflect.get(target, property, target)
    });
    runInNewContext(body, {Scratch: member, console: {warn: () => undefined}});

    expect(captured).toHaveLength(1);
  });
});
