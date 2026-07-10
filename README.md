# vite-plugin-turbowarp-extension

A Vite plugin for building TypeScript projects as single-file TurboWarp extensions.

## Status

This project is under initial development. The public API may change before the first stable release.

## Installation

```bash
npm install --save-dev @kubohiroya/vite-plugin-turbowarp-extension
```

Until the package is published, install it from GitHub or use a local workspace dependency.

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

## Build Guarantees

The plugin rejects builds that:

- produce more than one JavaScript chunk;
- retain `import` or `export` statements;
- contain zero or multiple `Scratch.extensions.register(...)` calls;
- use an output file name that does not end in `.js`.

See [docs/architecture.md](docs/architecture.md) for the design and build contract.

## Development

```bash
npm install
npm run check
```

`npm run check` performs TypeScript checking, unit tests, and package compilation.

## License

MPL-2.0
