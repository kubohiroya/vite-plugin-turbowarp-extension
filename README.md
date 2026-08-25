# vite-plugin-turbowarp-extension

A Vite plugin for building TypeScript projects as single-file TurboWarp extensions.

## Status

This project is under initial development. The public API may change before the first stable release.

This package is not a TurboWarp extension by itself. It is the build plugin used by extension projects and by `turbowarp-extension-template`.

## Requirements

- Node.js 20 or later
- Vite 6 or later
- an ESM project using `vite build`

The package is ESM-only and declares `peerDependencies.vite` as `>=6.0.0`.

## Installation

```bash
npm install --save-dev @kubohiroya/vite-plugin-turbowarp-extension@0.1.1
```

## Usage

```ts
// vite.config.ts
import {defineConfig} from 'vite';
import {turboWarpExtension} from '@kubohiroya/vite-plugin-turbowarp-extension';

export default defineConfig({
  plugins: [
    turboWarpExtension({
      id: 'exampleextension',
      name: 'Example Extension',
      description: 'An example TurboWarp extension.',
      author: 'Example Author',
      license: 'MPL-2.0',
      fileName: 'example-extension.js'
    })
  ]
});
```

The extension entry point should register the extension exactly once and should not export public module values.

```ts
// src/index.ts
import {ExampleExtension} from './extension.js';

Scratch.extensions.register(new ExampleExtension());
```

Run the build with:

```bash
vite build
```

The generated file has the following outer structure:

```js
// Name: Example Extension
// ID: exampleextension
// Description: An example TurboWarp extension.
// By: Example Author
// License: MPL-2.0

(function (Scratch) {
  'use strict';

  // Bundled extension implementation
})(Scratch);
```

## Build guarantees

The plugin rejects builds that:

- produce any output other than one JavaScript chunk;
- retain `import` or `export` statements;
- contain zero or multiple `Scratch.extensions.register(...)` calls;
- use an output file name that does not end in `.js`.

Metadata values must be single-line strings. The extension ID may contain only lowercase letters and numbers.

## Architecture / contract

Plugin responsibility:

- single-file extension output;
- deterministic metadata header;
- `(function (Scratch) { ... })(Scratch);` wrapper;
- one `Scratch.extensions.register(...)` call;
- rejection of leftover module syntax.

Template responsibility:

- project scaffold;
- README generation wiring;
- block definitions;
- extension manifest generation;
- repository policy for generated extension packages.

See [docs/architecture.md](docs/architecture.md) for the design and build contract. See [docs/readme-generation.md](docs/readme-generation.md) for the library API that extension templates can use to maintain generated block references.

## Development

```bash
npm ci
npm run check
```

`npm run check` performs TypeScript checking, unit tests, package compilation, repository policy validation, and package archive validation.

## Release

`package.json` is the version source of truth. The release tag must match `v0.1.1` for this package version.

Before publishing:

```bash
npm run check
npm pack --dry-run --ignore-scripts
```

The package archive must include compiled `dist/` output, type declarations, `docs/`, `README.md`, and `LICENSE`.

## License

SPDX-License-Identifier: MPL-2.0
