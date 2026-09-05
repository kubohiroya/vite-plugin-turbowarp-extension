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
the minifier.

### Why the prelude sits outside the wrapper

Vendored runtime bundles are typically UMD distributions that detect their host environment
and attach themselves to the global object. Evaluating them inside the `'use strict'` wrapper
can change their behaviour, so the prelude is placed before the IIFE and runs in sloppy mode.

The prelude is not part of the Rollup module graph, so it is validated separately: it is parsed
as a script — which rejects `import` and `export` declarations by construction — and scanned for
dynamic imports. Parsing cost is roughly 0.2 s per megabyte of prelude.

### Minification

`build.minify` is left to the consuming project unless the `minify` option is set. The plugin's
`config` hook only supplies a default when neither has chosen a value, so a project keeps
whatever it configured.

Two knobs reach the minifier, and they do not behave the same way here:

- `build.minify` goes through Vite, which forces `minifyWhitespace: false` for `build.lib`
  builds in the `es` format to preserve pure annotations. The plugin always uses that
  combination, so this path shortens identifiers and syntax but leaves whitespace in place.
- `rollupOptions.output.minify` goes straight to Rolldown's Oxc minifier and is not subject to
  that rule, so it is the option to reach for when output size matters.

Legal comments need both layers to agree. `output.minify.codegen.legalComments` alone is not
enough: `output.comments` drops legal comments before the minifier sees them, so
`{comments: {legal: true}}` must accompany it. Without that pairing the notices of bundled
dependencies disappear silently.

Oxc emits non-ASCII characters as-is, so extension names and block text in other scripts are
not escaped and no charset option is needed.

`build.minify: 'esbuild'` still resolves under Vite 8, but it routes through a deprecated code
path that requires esbuild to be installed separately. A project carrying that setting over
from Vite 7 will fail at `renderChunk`; `'oxc'` is the value to use.

### Known issue: Oxc whitespace removal can change runtime behaviour

Whitespace removal is the most conservative transform a minifier performs, so it is reasonable
to expect it to preserve behaviour. On one large bundle it did not.

In a 3.2 MB extension, with `compress` and `mangle` both disabled,
`output.minify.codegen.removeWhitespace` alone was enough to break the bundled YAML parser at
runtime: documents failed with `Nested mappings are not allowed in compact mappings`, which the
parser raises when the text it received has lost its newlines. Turning whitespace removal off
made the same bundle work; turning `compress` or `mangle` on, with whitespace removal off, kept
it working.

The behaviour reproduces on every rolldown in the 1.2.x line (1.2.0, 1.2.4, 1.2.6, 1.2.7), so
it is not a recent regression, and 1.2.7 is the current release. The root cause has not been
identified: template literals keep their newlines, and tagged template `raw` strings are intact,
so the obvious explanations were ruled out. No upstream issue matches the symptom, though
[oxc#24331](https://github.com/oxc-project/oxc/issues/24331) tracks runtime-correctness bugs
found by differential testing, codegen among them, and
[rolldown#10566](https://github.com/rolldown/rolldown/issues/10566) records a minifier fault
that does not reproduce in the Oxc playground — so the defect can also sit in Rolldown's
integration rather than in Oxc.

`build.minify: 'terser'` is the workaround. Terser has no `build.lib` carve-out in Vite, so it
removes whitespace, and on that bundle it produced output within 0.1% of the esbuild build the
project had used before. It needs `terser` installed, and it is roughly an order of magnitude
slower than Oxc.

None of this affects the header or the prelude, which the plugin concatenates after the
minifier has run.

## Vite Integration

The plugin uses the following hooks:

- `config` to enforce the build format, target, and single-file output;
- `config` also receives the consuming project's configuration, so `build.minify` is only
  defaulted when neither the project nor the `minify` option has set it;
- `generateBundle` to parse, validate, and transform the final bundle.

The plugin is applied only during `vite build`.

## Compatibility

The plugin targets Vite 8 and later and emits JavaScript targeting ES2020-compatible browsers.

Vite 8 replaced Rollup with Rolldown. The two pipelines differ in the option names for
single-chunk output, in how `build.minify` behaves, and in the configuration surface for legal
comments and character escaping. Supporting both would mean carrying a fork of the build
contract, so 0.3.0 narrowed the range instead. Projects on Vite 6 or 7 should stay on 0.2.x.
