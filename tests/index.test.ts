import {describe, expect, it} from 'vitest';
import type {OutputAsset, OutputChunk} from 'rollup';
import {build, type Plugin} from 'vite';
import {
  createTurboWarpBundle,
  turboWarpExtension,
  validateBundleCode,
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

describe('createTurboWarpBundle', () => {
  it('adds metadata and the TurboWarp IIFE wrapper', () => {
    const result = createTurboWarpBundle(
      options,
      'Scratch.extensions.register(new ExampleExtension());'
    );

    expect(result).toContain('// Name: Example Extension');
    expect(result).toContain('// ID: exampleextension');
    expect(result).toContain('(function (Scratch) {');
    expect(result).toContain("  'use strict';");
    expect(result).toContain('})(Scratch);');
  });
});

describe('validateBundleCode', () => {
  it('accepts exactly one registration call', () => {
    expect(() =>
      validateBundleCode('Scratch.extensions.register(new ExampleExtension());')
    ).not.toThrow();
  });

  it('rejects module syntax', () => {
    expect(() =>
      validateBundleCode(
        'export{};Scratch.extensions.register(new ExampleExtension());'
      )
    ).toThrow(/import or export/);
  });

  it('ignores registration-like text in strings and comments', () => {
    expect(() =>
      validateBundleCode(
        [
          'const message = "Scratch.extensions.register(";',
          '// Scratch.extensions.register(fake);',
          'Scratch.extensions.register(new ExampleExtension());'
        ].join('\n')
      )
    ).not.toThrow();
  });

  it('rejects dynamic imports', () => {
    expect(() =>
      validateBundleCode(
        "import('./lazy.js'); Scratch.extensions.register(new ExampleExtension());"
      )
    ).toThrow(/import or export/);
  });

  it('rejects missing registration', () => {
    expect(() => validateBundleCode('const value = 1;')).toThrow(/found 0/);
  });

  it('rejects multiple registrations', () => {
    expect(() =>
      validateBundleCode(
        'Scratch.extensions.register(a); Scratch.extensions.register(b);'
      )
    ).toThrow(/found 2/);
  });
});

describe('turboWarpExtension', () => {
  it('validates required options', () => {
    expect(() =>
      turboWarpExtension({...options, fileName: 'extension.txt'})
    ).toThrow(/must end with \.js/);
  });

  it('rejects invalid extension IDs', () => {
    expect(() => turboWarpExtension({...options, id: 'Example Extension'})).toThrow(
      /lowercase letters and numbers/
    );
  });

  it('rejects multiline metadata', () => {
    expect(() =>
      createTurboWarpBundle(
        {...options, description: 'First line\nconsole.log("outside wrapper");'},
        'Scratch.extensions.register(new ExampleExtension());'
      )
    ).toThrow(/single-line string/);
  });
});

describe('Vite integration', () => {
  it('builds one wrapped JavaScript file', async () => {
    const output = await buildFixture();

    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      fileName: options.fileName,
      type: 'chunk'
    });
    expect(output[0]?.type === 'chunk' ? output[0].code : '').toContain(
      "(function (Scratch) {\n  'use strict';"
    );
  });

  it('rejects additional emitted assets', async () => {
    await expect(buildFixture(true)).rejects.toThrow(/exactly one JavaScript output file/);
  });
});

async function buildFixture(
  emitAsset = false
): Promise<Array<OutputAsset | OutputChunk>> {
  const virtualEntry: Plugin = {
    name: 'test-virtual-entry',
    resolveId(id) {
      if (id.endsWith('virtual:entry')) {
        return '\0virtual:entry';
      }
    },
    load(id) {
      if (id === '\0virtual:entry') {
        return 'Scratch.extensions.register({});';
      }
    },
    buildStart() {
      if (emitAsset) {
        this.emitFile({
          type: 'asset',
          fileName: 'extra.txt',
          source: 'extra'
        });
      }
    }
  };

  const result = await build({
    build: {
      write: false
    },
    configFile: false,
    logLevel: 'silent',
    plugins: [
      virtualEntry,
      turboWarpExtension({
        ...options,
        entry: 'virtual:entry'
      })
    ]
  });

  if (Array.isArray(result)) {
    return result.flatMap((item) => item.output);
  }

  if (!('output' in result)) {
    throw new TypeError('Expected a Rollup build output.');
  }

  return result.output;
}
