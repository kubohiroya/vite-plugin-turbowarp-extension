import {describe, expect, it} from 'vitest';
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
        "export const value = 1;\nScratch.extensions.register(new ExampleExtension());"
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
});
