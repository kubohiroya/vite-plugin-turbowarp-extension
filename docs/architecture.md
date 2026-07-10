# Architecture

## Purpose

`vite-plugin-turbowarp-extension` converts a TypeScript/Vite project into a single JavaScript file suitable for loading as a TurboWarp custom extension.

## Responsibilities

The plugin:

1. configures Vite to emit exactly one JavaScript chunk;
2. prevents code splitting and leftover module syntax;
3. adds TurboWarp Extension Gallery metadata;
4. wraps the generated bundle as `(function (Scratch) { ... })(Scratch);`;
5. validates that the extension registers exactly once;
6. assigns the configured output file name.

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

- no `import` or `export` statements remain;
- the file begins with TurboWarp metadata comments;
- the implementation is wrapped in an IIFE that receives `Scratch` as an argument;
- strict mode is enabled;
- `Scratch.extensions.register(...)` occurs exactly once;
- no additional JavaScript chunks are emitted.

## Vite Integration

The plugin uses the following hooks:

- `config` to enforce the build format, target, and single-file output;
- `generateBundle` to validate and transform the final bundle.

The plugin is applied only during `vite build`.

## Compatibility

The initial release targets Vite 6 and later and emits JavaScript targeting ES2020-compatible browsers.
