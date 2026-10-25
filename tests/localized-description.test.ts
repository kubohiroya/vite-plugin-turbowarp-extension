import {describe, expect, it} from 'vitest';
import {createTurboWarpBundle, type TurboWarpExtensionOptions} from '../src/index.js';

const options: TurboWarpExtensionOptions = {
  id: 'example', name: 'Example', description: 'Default description.',
  author: 'Example Author', license: 'MPL-2.0', fileName: 'example.js'
};
const source = 'Scratch.extensions.register({getInfo() { return {id: "example", name: "Example", blocks: []}; }});';

describe('localized description headers', () => {
  it('keeps core metadata first and emits normalized translations in deterministic order', () => {
    const a = createTurboWarpBundle({...options, unsandboxed: 'required', descriptions: {
      'ja-JP': '日本向けの説明。', ja: '日本語の説明。', en: 'English description.'
    }}, source);
    const b = createTurboWarpBundle({...options, unsandboxed: 'required', descriptions: {
      en: 'English description.', ja: '日本語の説明。', 'ja-JP': '日本向けの説明。'
    }}, source);
    expect(a).toBe(b);
    expect(a).toContain('// Description: Default description.\n// By: Example Author\n// License: MPL-2.0\n// Unsandboxed: required\n// Description[en]: English description.\n// Description[ja]: 日本語の説明。\n// Description[ja-jp]: 日本向けの説明。');
  });

  it('passes translations to custom header callbacks without changing the old output', () => {
    let received;
    createTurboWarpBundle({...options, descriptions: {ja: '説明。'}, header: metadata => {
      received = metadata.descriptions;
      return '// Custom header';
    }}, source);
    expect(received).toEqual({ja: '説明。'});
    expect(createTurboWarpBundle(options, source)).not.toContain('Description[');
    expect(createTurboWarpBundle({...options, descriptions: {},}, source)).toBe(createTurboWarpBundle(options, source));
  });

  it.each(['ja_JP', 'ja]\n// Unsandboxed', '__proto__', '', '1ja'])('rejects invalid language tag %s', locale => {
    expect(() => createTurboWarpBundle({...options, descriptions: {[locale]: 'Text'}}, source)).toThrow(/language tags/);
  });

  it('rejects case-insensitive duplicate language tags', () => {
    expect(() => createTurboWarpBundle({...options, descriptions: {ja: 'A', JA: 'B'}}, source)).toThrow(/unique language tags/);
  });

  it.each(['', ' ', 'Line\nInjected', 'Line\rInjected', 'Line\u2028Injected', 'Line\u2029Injected'])('rejects empty or multiline text %j', description => {
    expect(() => createTurboWarpBundle({...options, descriptions: {ja: description}}, source)).toThrow(/single-line/);
  });

  it.each([null, [], 'ja', {ja: 12}])('rejects a malformed record %j', descriptions => {
    expect(() => createTurboWarpBundle({...options, descriptions: descriptions as unknown as Record<string, string>}, source)).toThrow(/descriptions/);
  });
});
