# Architecture

## Purpose

`vite-plugin-turbowarp-extension` converts a TypeScript/Vite project into a single JavaScript file suitable for loading as a TurboWarp custom extension.

## Responsibilities

The plugin:

1. configures Vite to emit exactly one JavaScript file;
2. prevents code splitting and leftover module syntax;
3. adds TurboWarp Extension Gallery metadata, or the configured replacement header;
4. wraps the generated bundle as `(function (Scratch) { ... })(Scratch);`;
5. inserts an optional vendored prelude between the header and the wrapper;
6. validates the number of `Scratch.extensions.register(...)` calls against the configured range;
7. assigns the configured output file name.

The plugin does not:

- define the complete TurboWarp or Scratch API type surface;
- implement extension-specific logic;
- publish packages or GitHub releases;
- guarantee acceptance into the official TurboWarp Extension Gallery.

## Public API

```ts
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

## Build Contract

A successful build produces one JavaScript file with the following properties:

- no `import` or `export` statements remain, in either the bundled code or the prelude;
- the file begins with TurboWarp metadata comments, unless `header` replaces or disables them;
- the implementation is wrapped in an IIFE that receives `Scratch` as an argument;
- strict mode is enabled inside the wrapper;
- `Scratch.extensions.register(...)` occurs within the range given by `registrations`, which defaults to exactly once;
- no additional JavaScript chunks are emitted;
- no additional assets are emitted.

## Bundle Extensions

A bundle extension packs several TurboWarp extensions into one file. Four options cover
that shape, and all of them default to the single-extension behaviour.

| option | default | effect |
| --- | --- | --- |
| `registrations` | `1` | accepted number of `Scratch.extensions.register(...)` calls, as a count or a `{min, max}` range |
| `header` | the five metadata lines | `false` omits them; a string or a callback replaces them |
| `prelude` | none | inserted verbatim between the header and the wrapper |
| `minify` | unset | overrides `build.minify`; when unset the user's own setting is kept |

### Output layout

```
<header>

<prelude>

(function (Scratch) {
  'use strict';

  <bundled extension code>

})(Scratch);
```

Sections are joined with one blank line and trailing whitespace is dropped; the content of
each section is otherwise left alone.

### Why the header is concatenated in `generateBundle`

Rollup's `output.banner` cannot carry the header. Rollup prepends the banner while the chunk
is rendered, which is *before* the minifier's `renderChunk` hook runs, so the minifier treats
it as ordinary source text:

- `// Name:` and `// ID:` are plain comments, so they are removed outright;
- comments that qualify as legal comments (`@license`, `@preserve`, `//!`, `/*!`) survive, but
  `legalComments: 'eof'` relocates them to the end of the file.

A header passed through the banner therefore either disappears or ends up in the wrong place,
and TurboWarp reads the metadata from the top of the file. The plugin concatenates the header
and the prelude in `generateBundle`, which runs after `renderChunk`, so neither is exposed to
the minifier. This holds for both the esbuild path (Vite 6/7) and the Oxc path (Vite 8).

### Why the prelude sits outside the wrapper

Vendored runtime bundles are typically UMD distributions that detect their host environment
and attach themselves to the global object. Evaluating them inside the `'use strict'` wrapper
can change their behaviour, so the prelude is placed before the IIFE and runs in sloppy mode.

The prelude is not part of the Rollup module graph, so it is validated separately: it is parsed
as a script — which rejects `import` and `export` declarations by construction — and scanned for
dynamic imports. Parsing cost is roughly 0.2 s per megabyte of prelude.

### Minification

`build.minify` is left to the consuming project unless the `minify` option is set. Note that
Vite forces `minifyWhitespace: false` for `build.lib` builds in the `es` format to preserve
pure annotations, so under Vite 6/7 `build.minify: 'esbuild'` shortens identifiers only. Full
minification requires `build.minify: 'terser'` there, or `rollupOptions.output.minify` under
Vite 8.

## Vite Integration

The plugin uses the following hooks:

- `config` to enforce the build format, target, and single-file output;
- `config` also receives the consuming project's configuration, so `build.minify` is only
  defaulted when neither the project nor the `minify` option has set it;
- `generateBundle` to parse, validate, and transform the final bundle.

The plugin is applied only during `vite build`.

## Compatibility

The initial release targets Vite 6 and later and emits JavaScript targeting ES2020-compatible browsers.
