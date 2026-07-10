export type DocumentedBlockType = 'command' | 'reporter' | 'boolean' | 'hat';

export interface BlockDocumentation {
  opcode: string;
  text: string;
  blockType: DocumentedBlockType;
  description?: string;
}

export type BlockDocumentationEntry = BlockDocumentation | '---';

export interface ReadmeBlockSectionOptions {
  heading?: string;
  beginMarker?: string;
  endMarker?: string;
}

export const DEFAULT_BEGIN_MARKER = '<!-- BEGIN GENERATED BLOCKS -->';
export const DEFAULT_END_MARKER = '<!-- END GENERATED BLOCKS -->';

export function generateBlockDocumentationMarkdown(
  entries: readonly BlockDocumentationEntry[],
  options: ReadmeBlockSectionOptions = {}
): string {
  const heading = options.heading ?? '## Blocks';
  const lines: string[] = [heading, ''];

  for (const entry of entries) {
    if (entry === '---') {
      if (lines.at(-1) !== '') lines.push('');
      lines.push('---', '');
      continue;
    }

    validateBlockDocumentation(entry);
    lines.push(`### \`${entry.text}\``, '');
    lines.push(`- **Opcode:** \`${entry.opcode}\``);
    lines.push(`- **Type:** ${formatBlockType(entry.blockType)}`);

    if (entry.description) {
      lines.push('', entry.description.trim());
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function replaceGeneratedBlockSection(
  readme: string,
  generatedMarkdown: string,
  options: ReadmeBlockSectionOptions = {}
): string {
  const beginMarker = options.beginMarker ?? DEFAULT_BEGIN_MARKER;
  const endMarker = options.endMarker ?? DEFAULT_END_MARKER;

  const beginIndexes = findAllIndexes(readme, beginMarker);
  const endIndexes = findAllIndexes(readme, endMarker);

  if (beginIndexes.length !== 1 || endIndexes.length !== 1) {
    throw new Error(
      `Expected exactly one generated block section marker pair, found ${beginIndexes.length} begin marker(s) and ${endIndexes.length} end marker(s).`
    );
  }

  const beginIndex = beginIndexes[0];
  const endIndex = endIndexes[0];
  if (beginIndex === undefined || endIndex === undefined || endIndex < beginIndex) {
    throw new Error('The generated block section end marker must appear after the begin marker.');
  }

  const contentStart = beginIndex + beginMarker.length;
  const before = readme.slice(0, contentStart).replace(/[ \t]*$/, '');
  const after = readme.slice(endIndex).replace(/^[ \t]*/, '');
  const body = generatedMarkdown.trim();

  return `${before}\n\n${body}\n\n${after}`;
}

export function assertGeneratedBlockSectionCurrent(
  readme: string,
  entries: readonly BlockDocumentationEntry[],
  options: ReadmeBlockSectionOptions = {}
): void {
  const generated = generateBlockDocumentationMarkdown(entries, options);
  const expected = replaceGeneratedBlockSection(readme, generated, options);

  if (expected !== readme) {
    throw new Error('The generated README block documentation is out of date.');
  }
}

function validateBlockDocumentation(block: BlockDocumentation): void {
  if (!block.opcode.trim()) throw new TypeError('Block documentation opcode must not be empty.');
  if (!block.text.trim()) throw new TypeError('Block documentation text must not be empty.');
}

function formatBlockType(blockType: DocumentedBlockType): string {
  switch (blockType) {
    case 'command':
      return 'Command';
    case 'reporter':
      return 'Reporter';
    case 'boolean':
      return 'Boolean';
    case 'hat':
      return 'Hat';
  }
}

function findAllIndexes(source: string, search: string): number[] {
  const indexes: number[] = [];
  let offset = 0;

  while (offset <= source.length) {
    const index = source.indexOf(search, offset);
    if (index === -1) break;
    indexes.push(index);
    offset = index + search.length;
  }

  return indexes;
}
