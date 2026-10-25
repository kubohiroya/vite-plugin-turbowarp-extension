# vite-plugin-turbowarp-extension

English | [日本語](README.ja.md)

A Vite plugin for building TypeScript projects as single-file TurboWarp extensions.

## Status

This project is under initial development. The public API may change before the first stable release.

This package is not a TurboWarp extension by itself. It is the build plugin used by extension projects and by `turbowarp-extension-template`.

## Requirements

- Node.js `>=22.18.0`, the first release that runs the TypeScript repository scripts without a flag (it also satisfies Vite 7 and later)
- Vite 8 or later
- an ESM project using `vite build`

The package is ESM-only and declares `peerDependencies.vite` as `>=8.0.0`.
Vite 8 replaced Rollup with Rolldown, and the plugin targets that build pipeline only.
Projects still on Vite 6 or 7 should stay on 0.2.x.

## Installation

```bash
npm install --save-dev @kubohiroya/vite-plugin-turbowarp-extension@0.8.0
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

### Localized descriptions

The optional `descriptions` record emits language-tagged descriptions alongside the existing
`Description` header.

```ts
// Add to the turboWarpExtension options shown above.
descriptions: {ja: 'TurboWarpの機能拡張の例です。'}
```

```js
// Description: An example TurboWarp extension.
// Description[ja]: TurboWarpの機能拡張の例です。
```

The actual output keeps Name, ID, Description, By, License and Unsandboxed first, then appends
localized descriptions in language-tag order. Tags such as `ja` and `ja-JP` are case-insensitive
and emitted in lowercase. Duplicate tags, empty descriptions and line breaks are rejected.
Without this option the output is unchanged. A supporting security dialog selects an exact
Editor locale, then its base language, then the original `Description`, without evaluating
extension code. A custom `header` replaces these comments too; callbacks receive
`metadata.descriptions`.

## Sandbox requirement

TurboWarp asks the user, in its extension security dialog, whether to "Run without sandbox".
An extension that needs the unsandboxed API can declare that statically with the `unsandboxed`
option, which adds one line to the default header right after `// License:`:

| value | meaning |
| --- | --- |
| `'required'` | the extension cannot work sandboxed |
| `'optional'` | it works sandboxed, with fewer features |
| `'not-needed'` | it never needs the unsandboxed API |

```ts
turboWarpExtension({
  // ...metadata
  unsandboxed: 'required'
});
```

```js
// License: MPL-2.0
// Unsandboxed: required
```

`@kubohiroya/sb3-toolchain` reads this line when it bundles extensions. Any other value is
rejected at config time. Without the option the output does not change. A string `header`
replaces the line along with the rest; a header callback receives the value as
`metadata.unsandboxed`.

Set `sandboxedGuard: true` as well to make a standalone extension react to a sandboxed load
(`Scratch.extensions.unsandboxed !== true`) the way sb3-toolchain bundles do:

- `required`: the entry does not run. A placeholder with the extension's own ID and name is
  registered instead, its palette made of labels that explain how to reload with "Run without
  sandbox", and `console.error` reports it. Without this, a sandboxed load that throws before
  registering leaves TurboWarp loading the project forever.
- `optional`: the entry runs, its palette is prefixed with a notice, and `console.warn` reports it.

The notice is in English or Japanese, chosen by `Scratch.translate.language`. The guard is
inserted at the top of the IIFE, after minification, and never spells
`Scratch.extensions.register(`: the file still contains exactly one such call, so it can be
bundled by sb3-toolchain. The guard is opt-in because a bundle already shows its own notice, so
an `optional` member that also carries the guard shows the notice twice.

## Bundle extensions

A bundle extension packs several TurboWarp extensions into one file. Three optional settings
cover that shape. All of them default to the single-extension behaviour, so existing projects
need no change.

| option | type | default | effect |
| --- | --- | --- | --- |
| `header` | `false \| string \| ((metadata) => string)` | the metadata lines | `false` omits them; a string or callback replaces them |
| `prelude` | `string` | none | inserted verbatim between the header and the wrapper |
| `minify` | `boolean` | unset | overrides `build.minify`; when unset the project's own setting is kept |

```ts
turboWarpExtension({
  // ...metadata
  fileName: 'bundle.js',
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
- contain zero or multiple `Scratch.extensions.register(...)` calls;
- use an output file name that does not end in `.js`.

Metadata values must be single-line strings. The extension ID may contain only lowercase letters and numbers.

## Architecture / contract

Plugin responsibility:

- single-file extension output;
- deterministic metadata header, or the configured replacement;
- optional `// Unsandboxed:` declaration and sandboxed-load guard;
- `(function (Scratch) { ... })(Scratch);` wrapper;
- header and prelude concatenation, after minification;
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

`package.json` is the version source of truth. The release tag must match `v0.8.0` for this package version.

Before publishing:

```bash
npm run check
npm pack --dry-run --ignore-scripts
```

The package archive must include compiled `dist/` output, type declarations, `docs/`, `README.md`, and `LICENSE`.

## License

SPDX-License-Identifier: MPL-2.0
