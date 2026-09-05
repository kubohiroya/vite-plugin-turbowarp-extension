import {describe, expect, it} from 'vitest';
import {
  build,
  type Plugin,
  type ResolvedConfig,
  type Rolldown,
  type UserConfig
} from 'vite';
import {
  createTurboWarpBundle,
  turboWarpExtension,
  validateBundleCode,
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

  it('omits metadata lines when the header is disabled', () => {
    const result = createTurboWarpBundle(
      {...options, header: false},
      'Scratch.extensions.register(new ExampleExtension());'
    );

    expect(result).not.toContain('// Name:');
    expect(result).not.toContain('// ID:');
    expect(result.startsWith('(function (Scratch) {')).toBe(true);
  });

  it('uses a string header verbatim', () => {
    const header = '// Bundle of 2 extensions\n// Notice: extension A, extension B';
    const result = createTurboWarpBundle(
      {...options, header},
      'Scratch.extensions.register(new ExampleExtension());'
    );

    expect(result.startsWith(`${header}\n\n(function (Scratch) {`)).toBe(true);
    expect(result).not.toContain('// Name: Example Extension');
  });

  it('passes the extension metadata to a header callback', () => {
    const received: TurboWarpExtensionMetadata[] = [];
    const result = createTurboWarpBundle(
      {
        ...options,
        header: (metadata) => {
          received.push(metadata);
          return `// ${metadata.name} (${metadata.id})`;
        }
      },
      'Scratch.extensions.register(new ExampleExtension());'
    );

    expect(received).toEqual([
      {
        id: 'exampleextension',
        name: 'Example Extension',
        description: 'An example extension.',
        author: 'Example Author',
        license: 'MPL-2.0'
      }
    ]);
    expect(result.startsWith('// Example Extension (exampleextension)\n\n')).toBe(true);
  });

  it('inserts the prelude after the header and before the wrapper', () => {
    const prelude = 'var vendored = (function () {\n  return {version: "1.0"};\n})();';
    const result = createTurboWarpBundle(
      {...options, prelude},
      'Scratch.extensions.register(new ExampleExtension());'
    );

    const headerIndex = result.indexOf('// Name: Example Extension');
    const preludeIndex = result.indexOf(prelude);
    const wrapperIndex = result.indexOf('(function (Scratch) {');

    expect(preludeIndex).toBeGreaterThan(headerIndex);
    expect(wrapperIndex).toBeGreaterThan(preludeIndex);
    expect(result).toContain(`\n\n${prelude}\n\n(function (Scratch) {`);
  });

  it('keeps the prelude out of the strict mode wrapper', () => {
    const prelude = 'var vendored = 1;';
    const result = createTurboWarpBundle({...options, prelude}, 'Scratch.extensions.register({});');

    expect(result.indexOf(prelude)).toBeLessThan(result.indexOf("'use strict';"));
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

  it('accepts multiple registrations when a lower bound is configured', () => {
    expect(() =>
      validateBundleCode(
        'Scratch.extensions.register(a); Scratch.extensions.register(b);',
        undefined,
        {min: 1}
      )
    ).not.toThrow();
  });

  it('accepts an exact registration count', () => {
    const source = Array.from(
      {length: 7},
      (_value, index) => `Scratch.extensions.register(e${index});`
    ).join('\n');

    expect(() => validateBundleCode(source, undefined, 7)).not.toThrow();
    expect(() => validateBundleCode(source, undefined, 6)).toThrow(
      /Expected exactly 6 Scratch\.extensions\.register\(\.\.\.\) calls, but found 7\./
    );
  });

  it('reports the expected range in the failure message', () => {
    expect(() =>
      validateBundleCode('Scratch.extensions.register(a);', undefined, {min: 2})
    ).toThrow(/Expected at least 2 Scratch\.extensions\.register\(\.\.\.\) calls, but found 1\./);

    expect(() =>
      validateBundleCode(
        'Scratch.extensions.register(a); Scratch.extensions.register(b);',
        undefined,
        {min: 3, max: 5}
      )
    ).toThrow(/Expected between 3 and 5 Scratch\.extensions\.register\(\.\.\.\) calls, but found 2\./);
  });

  it('rejects an invalid registration range', () => {
    expect(() => validateBundleCode('', undefined, 0)).toThrow(/integer of 1 or more/);
    expect(() => validateBundleCode('', undefined, {min: 3, max: 2})).toThrow(
      /must not be greater than/
    );
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

  it('rejects invalid optional options', () => {
    expect(() =>
      turboWarpExtension({...options, registrations: 1.5})
    ).toThrow(/integer of 1 or more/);
    expect(() =>
      turboWarpExtension({...options, prelude: 1 as unknown as string})
    ).toThrow(/"prelude" must be a string/);
    expect(() =>
      turboWarpExtension({...options, header: 1 as unknown as string})
    ).toThrow(/"header" must be false, a string, or a function/);
    expect(() =>
      turboWarpExtension({...options, minify: 'esbuild' as unknown as boolean})
    ).toThrow(/"minify" must be a boolean/);
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
    await expect(buildFixture({emitAsset: true})).rejects.toThrow(
      /exactly one JavaScript output file/
    );
  });

  it('rejects a prelude that contains module syntax', async () => {
    await expect(
      buildFixture({pluginOptions: {prelude: "import './vendor.js';"}})
    ).rejects.toThrow(/prelude must not contain import or export statements/);
  });

  it('minifies the extension while keeping the wrapper and metadata', async () => {
    const source = [
      'class ExampleExtensionImplementation {',
      "  getInfo() { return {id: 'exampleextension', name: 'Example', blocks: []}; }",
      '}',
      'Scratch.extensions.register(new ExampleExtensionImplementation());'
    ].join('\n');

    const plain = await buildFixture({source});
    const minified = await buildFixture({source, pluginOptions: {minify: true}});

    const plainCode = plain[0]?.type === 'chunk' ? plain[0].code : '';
    const minifiedCode = minified[0]?.type === 'chunk' ? minified[0].code : '';

    expect(plainCode).toContain('ExampleExtensionImplementation');
    expect(minifiedCode).not.toContain('ExampleExtensionImplementation');
    expect(minifiedCode).toContain('// Name: Example Extension');
    expect(minifiedCode).toContain("(function (Scratch) {\n  'use strict';");
    expect(minifiedCode.length).toBeLessThan(plainCode.length);

    const body = minifiedCode
      .slice(minifiedCode.indexOf("'use strict';") + "'use strict';".length)
      .replace(/\}\)\(Scratch\);\s*$/, '');
    expect(() => validateBundleCode(body)).not.toThrow();
  });

  it('keeps the build unminified by default', async () => {
    let resolved: ResolvedConfig | undefined;
    await buildFixture({onResolved: (config) => (resolved = config)});

    expect(resolved?.build.minify).toBe(false);
  });

  it('respects a minify setting from the user config', async () => {
    let resolved: ResolvedConfig | undefined;
    await buildFixture({
      userBuild: {minify: 'oxc'},
      onResolved: (config) => (resolved = config)
    });

    expect(resolved?.build.minify).toBe('oxc');
  });

  it('lets the plugin option override the user config', async () => {
    let resolved: ResolvedConfig | undefined;
    await buildFixture({
      userBuild: {minify: true},
      pluginOptions: {minify: false},
      onResolved: (config) => (resolved = config)
    });

    expect(resolved?.build.minify).toBe(false);
  });
});

interface FixtureOptions {
  emitAsset?: boolean;
  source?: string;
  pluginOptions?: Partial<TurboWarpExtensionOptions>;
  userBuild?: UserConfig['build'];
  onResolved?: (config: ResolvedConfig) => void;
}

async function buildFixture({
  emitAsset = false,
  source = 'Scratch.extensions.register({});',
  pluginOptions,
  userBuild,
  onResolved
}: FixtureOptions = {}): Promise<Array<Rolldown.OutputAsset | Rolldown.OutputChunk>> {
  const virtualEntry: Plugin = {
    name: 'test-virtual-entry',
    resolveId(id) {
      if (id.endsWith('virtual:entry')) {
        return '\0virtual:entry';
      }
    },
    load(id) {
      if (id === '\0virtual:entry') {
        return source;
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

  const observer: Plugin = {
    name: 'test-config-observer',
    configResolved(config) {
      onResolved?.(config);
    }
  };

  const result = await build({
    build: {
      write: false,
      ...userBuild
    },
    configFile: false,
    logLevel: 'silent',
    plugins: [
      virtualEntry,
      observer,
      turboWarpExtension({
        ...options,
        ...pluginOptions,
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
