# vite-plugin-turbowarp-extension

A Vite plugin for building TypeScript projects as single-file TurboWarp extensions.

## Status

This project is under initial development. The public API may change before the first stable release.

This package is not a TurboWarp extension by itself. It is the build plugin used by extension projects and by `turbowarp-extension-template`.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`, the range Vite 7 and later require
- Vite 8 or later
- an ESM project using `vite build`

The package is ESM-only and declares `peerDependencies.vite` as `>=8.0.0`.
Vite 8 replaced Rollup with Rolldown, and the plugin targets that build pipeline only.
Projects still on Vite 6 or 7 should stay on 0.2.x.

## Installation

```bash
npm install --save-dev @kubohiroya/vite-plugin-turbowarp-extension@0.3.0
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

## Bundle extensions

A bundle extension packs several TurboWarp extensions into one file. Four optional settings
cover that shape. All of them default to the single-extension behaviour, so existing projects
need no change.

| option | type | default | effect |
| --- | --- | --- | --- |
| `registrations` | `number \| {min?: number; max?: number}` | `1` | accepted number of `Scratch.extensions.register(...)` calls |
| `header` | `false \| string \| ((metadata) => string)` | the five metadata lines | `false` omits them; a string or callback replaces them |
| `prelude` | `string` | none | inserted verbatim between the header and the wrapper |
| `minify` | `boolean` | unset | overrides `build.minify`; when unset the project's own setting is kept |

```ts
turboWarpExtension({
  // ...metadata
  fileName: 'bundle.js',
  registrations: {min: 1},
  header: notice,
  prelude: vendoredRuntime,
  minify: true
});
```

The generated file is laid out as `header`, `prelude`, then the IIFE. The prelude runs outside
the wrapper, in sloppy mode, because vendored UMD bundles rely on that. Both the header and the
prelude are concatenated after minification, so neither can be carried by the bundler's
`output.banner` — the minifier removes plain comments and relocates legal comments. See
[docs/architecture.md](docs/architecture.md) for the details.

## Build guarantees

The plugin rejects builds that:

- produce any output other than one JavaScript chunk;
- retain `import` or `export` statements, in either the bundled code or the prelude;
- make a number of `Scratch.extensions.register(...)` calls outside the `registrations` range,
  which defaults to exactly one;
- use an output file name that does not end in `.js`.

Metadata values must be single-line strings. The extension ID may contain only lowercase letters and numbers.

## Architecture / contract

Plugin responsibility:

- single-file extension output;
- deterministic metadata header, or the configured replacement;
- `(function (Scratch) { ... })(Scratch);` wrapper;
- header and prelude concatenation, after minification;
- `Scratch.extensions.register(...)` call-count validation;
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

`package.json` is the version source of truth. The release tag must match `v0.3.0` for this package version.

Before publishing:

```bash
npm run check
npm pack --dry-run --ignore-scripts
```

The package archive must include compiled `dist/` output, type declarations, `docs/`, `README.md`, and `LICENSE`.

## License

SPDX-License-Identifier: MPL-2.0
