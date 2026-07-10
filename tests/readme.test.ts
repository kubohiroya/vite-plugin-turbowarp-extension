import {describe, expect, it} from 'vitest';
import {
  assertGeneratedBlockSectionCurrent,
  generateBlockDocumentationMarkdown,
  replaceGeneratedBlockSection,
  type BlockDocumentationEntry
} from '../src/readme.js';

const blocks: BlockDocumentationEntry[] = [
  {
    opcode: 'sendNotification',
    text: 'send extended notification [MESSAGE]',
    blockType: 'command',
    description: 'Send a non-retained notification to all current waiters.'
  },
  '---',
  {
    opcode: 'waitForNotificationOrTimeout',
    text: 'extended notification [MESSAGE] received before [SECONDS] seconds',
    blockType: 'boolean'
  }
];

describe('generateBlockDocumentationMarkdown', () => {
  it('generates deterministic block documentation', () => {
    expect(generateBlockDocumentationMarkdown(blocks)).toBe(
      [
        '## Blocks',
        '',
        '### `send extended notification [MESSAGE]`',
        '',
        '- **Opcode:** `sendNotification`',
        '- **Type:** Command',
        '',
        'Send a non-retained notification to all current waiters.',
        '',
        '---',
        '',
        '### `extended notification [MESSAGE] received before [SECONDS] seconds`',
        '',
        '- **Opcode:** `waitForNotificationOrTimeout`',
        '- **Type:** Boolean',
        ''
      ].join('\n')
    );
  });
});

describe('replaceGeneratedBlockSection', () => {
  it('preserves hand-written README content outside the markers', () => {
    const readme = [
      '# Example',
      '',
      'Introduction.',
      '',
      '<!-- BEGIN GENERATED BLOCKS -->',
      '',
      'Old content.',
      '',
      '<!-- END GENERATED BLOCKS -->',
      '',
      'Footer.',
      ''
    ].join('\n');

    const generated = generateBlockDocumentationMarkdown(blocks);
    const result = replaceGeneratedBlockSection(readme, generated);

    expect(result).toContain('Introduction.');
    expect(result).toContain('Footer.');
    expect(result).not.toContain('Old content.');
    expect(result).toContain('send extended notification [MESSAGE]');
  });

  it('rejects missing markers', () => {
    expect(() => replaceGeneratedBlockSection('# Example\n', '## Blocks\n')).toThrow(
      /exactly one generated block section marker pair/
    );
  });

  it('rejects duplicated markers', () => {
    const readme = [
      '<!-- BEGIN GENERATED BLOCKS -->',
      '<!-- BEGIN GENERATED BLOCKS -->',
      '<!-- END GENERATED BLOCKS -->'
    ].join('\n');

    expect(() => replaceGeneratedBlockSection(readme, '## Blocks\n')).toThrow(
      /found 2 begin marker/
    );
  });
});

describe('assertGeneratedBlockSectionCurrent', () => {
  it('accepts a current README and rejects an outdated README', () => {
    const template = [
      '# Example',
      '',
      '<!-- BEGIN GENERATED BLOCKS -->',
      '<!-- END GENERATED BLOCKS -->',
      ''
    ].join('\n');
    const generated = generateBlockDocumentationMarkdown(blocks);
    const current = replaceGeneratedBlockSection(template, generated);

    expect(() => assertGeneratedBlockSectionCurrent(current, blocks)).not.toThrow();
    expect(() => assertGeneratedBlockSectionCurrent(template, blocks)).toThrow(/out of date/);
  });
});
