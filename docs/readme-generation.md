# README block documentation generation

The package exposes a small, deterministic API for generating a block reference and replacing a marked section of a README file.

## Why the generator uses explicit documentation data

The generator does not parse TypeScript source code or execute an arbitrary extension `getInfo()` implementation. Both approaches are brittle and can introduce build-time side effects.

Instead, an extension defines serializable block documentation data that can be shared by the runtime block definitions and the documentation generator.

```ts
import type {BlockDocumentationEntry} from '@kubohiroya/vite-plugin-turbowarp-extension';

export const blockDocumentation: BlockDocumentationEntry[] = [
  {
    opcode: 'lineCount',
    text: 'number of lines in [TEXT]',
    blockType: 'reporter',
    description: 'Return the number of lines in the supplied text.'
  }
];
```

## README markers

Add exactly one marker pair to the README.

```markdown
<!-- BEGIN GENERATED BLOCKS -->
<!-- END GENERATED BLOCKS -->
```

The generator replaces only the content between these markers. Hand-written text outside the section remains unchanged.

## Library API

```ts
import {readFile, writeFile} from 'node:fs/promises';
import {
  generateBlockDocumentationMarkdown,
  replaceGeneratedBlockSection
} from '@kubohiroya/vite-plugin-turbowarp-extension';
import {blockDocumentation} from './src/block-documentation.js';

const path = 'README.md';
const readme = await readFile(path, 'utf8');
const generated = generateBlockDocumentationMarkdown(blockDocumentation);
const updated = replaceGeneratedBlockSection(readme, generated);
await writeFile(path, updated);
```

## CI validation

Use `assertGeneratedBlockSectionCurrent()` to fail CI when the checked-in README no longer matches the block documentation definition.

```ts
import {readFile} from 'node:fs/promises';
import {assertGeneratedBlockSectionCurrent} from '@kubohiroya/vite-plugin-turbowarp-extension';
import {blockDocumentation} from './src/block-documentation.js';

const readme = await readFile('README.md', 'utf8');
assertGeneratedBlockSectionCurrent(readme, blockDocumentation);
```

A CLI and tighter Vite integration are intentionally deferred until the core data model and output format have been validated in the extension template and the three reference extensions.
