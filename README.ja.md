# vite-plugin-turbowarp-extension

[English](README.md) | 日本語

TypeScriptのプロジェクトを単一ファイルのTurboWarp拡張機能としてビルドするためのViteプラグインです。

## 状態

初期開発中です。最初の安定版リリースまでは公開APIが変わる可能性があります。

このpackage自体はTurboWarp拡張機能ではありません。拡張機能のプロジェクトや
`turbowarp-extension-template`が使うビルド用プラグインです。

## 動作条件

- Node.js `>=24`（TypeScriptのリポジトリscriptをフラグなしで実行でき、Vite 7以降の要件も満たします）
- Vite 8以降
- `vite build`を使うESMプロジェクト

このpackageはESM専用で、`peerDependencies.vite`に`>=8.0.0`を宣言しています。
Vite 8でRollupがRolldownへ置き換わり、このプラグインはそのビルドパイプラインだけを対象にしています。
Vite 6や7のままのプロジェクトは0.2.x系を使い続けてください。

## インストール

```bash
npm install --save-dev @kubohiroya/vite-plugin-turbowarp-extension@0.9.0
```

## 使い方

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

拡張機能のentry pointは、拡張機能をちょうど1回だけ登録し、公開のmodule値をexportしないでください。

```ts
// src/index.ts
import {ExampleExtension} from './extension.js';

Scratch.extensions.register(new ExampleExtension());
```

ビルドは次で実行します。

```bash
vite build
```

生成されるファイルの外側は次の構造になります。

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

### 説明文の多言語化

`descriptions`に言語タグと説明文の組を指定すると、既存の`Description`に加えて言語別コメントを出力します。

```ts
turboWarpExtension({
  id: 'exampleextension',
  name: 'Example Extension',
  description: 'An example TurboWarp extension.',
  descriptions: {ja: 'TurboWarpの機能拡張の例です。'},
  author: 'Example Author',
  license: 'MPL-2.0',
  fileName: 'example-extension.js'
});
```

```js
// Description: An example TurboWarp extension.
// Description[ja]: TurboWarpの機能拡張の例です。
```

実際の出力ではName・ID・Description・By・License・Unsandboxedの基本情報を先に並べ、その後に言語別コメントを言語タグ順で追加します。言語タグは`ja`・`ja-JP`などを使い、大文字・小文字を区別せず、小文字で出力します。同じタグの重複、空の説明、改行は拒否します。未指定の場合の出力は従来と同じです。

対応する共通セキュリティダイアログは、Editorの言語の完全一致、基底言語、従来の`Description`の順に表示文を選びます。説明を得るために拡張コードを実行しません。`header`で全体を置き換える場合は翻訳コメントも呼び出し側で含めてください。コールバックは`metadata.descriptions`を受け取ります。

## サンドボックスの要否

TurboWarpは拡張機能のセキュリティダイアログで、「サンドボックス化せずに実行」するかどうかを利用者に
尋ねます。unsandboxed APIが必要な拡張機能は、`unsandboxed`オプションでそれを静的に宣言できます。
宣言すると、既定のheaderの`// License:`の直後に1行が加わります。

| 値 | 意味 |
| --- | --- |
| `'required'` | サンドボックス下では動作しない |
| `'optional'` | 機能は減るがサンドボックス下でも動作する |
| `'not-needed'` | unsandboxed APIを必要としない |

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

`@kubohiroya/sb3-toolchain`は拡張機能をbundleする際にこの行を読みます。これ以外の値はconfigの時点で
拒否します。オプションを指定しなければ出力は変わりません。文字列の`header`を指定した場合はこの行も含めて
置き換えられ、headerをcallbackで与えた場合は`metadata.unsandboxed`として値を受け取ります。

あわせて`sandboxedGuard: true`を指定すると、standaloneの拡張機能が、sb3-toolchainのbundleと同じように
サンドボックス下での読み込み（`Scratch.extensions.unsandboxed !== true`）へ反応します。

- `required`: entryを実行しません。代わりに、その拡張機能自身のIDと名前を持つplaceholderを登録します。
  パレットは「サンドボックス化せずに実行」で読み込み直す方法を説明するlabelで構成され、`console.error`でも
  報告します。これがないと、登録前に例外を投げたサンドボックス下の読み込みで、TurboWarpがプロジェクトを
  永久に読み込み続けてしまいます。
- `optional`: entryを実行し、パレットの先頭に注意書きを付け、`console.warn`で報告します。

注意書きの言語は`Scratch.translate.language`に応じて英語か日本語を選びます。guardはminify後にIIFEの
先頭へ挿入され、`Scratch.extensions.register(`という文字列を決して書きません。ファイル内のその呼び出しは
ちょうど1つのままなので、sb3-toolchainでbundleできます。guardがopt-inなのは、bundleが既に独自の注意書きを
表示するためで、guardを持つ`optional`なメンバーを含めると注意書きが二重に出てしまうからです。

## bundle拡張機能

bundle拡張機能は、複数のTurboWarp拡張機能を1つのファイルへまとめたものです。その形に対応する任意の設定が
3つあります。いずれも既定値は単一拡張機能の挙動なので、既存のプロジェクトを変更する必要はありません。

| オプション | 型 | 既定 | 効果 |
| --- | --- | --- | --- |
| `header` | `false \| string \| ((metadata) => string)` | metadataの各行 | `false`で省略、文字列またはcallbackで置き換え |
| `prelude` | `string` | なし | headerとwrapperの間へそのまま挿入 |
| `minify` | `boolean` | 未設定 | `build.minify`を上書き。未設定ならプロジェクトの設定を維持 |

```ts
turboWarpExtension({
  // ...metadata
  fileName: 'bundle.js',
  header: notice,
  prelude: vendoredRuntime,
  minify: true
});
```

生成されるファイルは`header`、`prelude`、IIFEの順に並びます。preludeはwrapperの外側、sloppy modeで
実行されます。vendoringされたUMD bundleがそれを前提にしているためです。headerとpreludeはどちらも
minify後に連結されます。したがってbundlerの`output.banner`では運べません。minifierは通常のコメントを
削除し、legal commentは位置を移動させてしまうからです。詳細は
[docs/architecture.md](docs/architecture.md)を参照してください。

## ビルドの保証

このプラグインは、次に該当するビルドを拒否します。

- JavaScript chunk 1つ以外の出力が生じる。
- bundle後のコードまたはpreludeに`import`や`export`が残っている。
- `Scratch.extensions.register(...)`の呼び出しが0個、または複数ある。
- 出力ファイル名が`.js`で終わらない。

metadataの値は1行の文字列でなければなりません。拡張機能IDに使えるのは小文字の英字と数字だけです。

## アーキテクチャと契約

プラグインの責務です。

- 単一ファイルの拡張機能を出力する。
- 決定的なmetadata header、または設定された置き換えを出力する。
- 任意の`// Unsandboxed:`宣言と、サンドボックス読み込み時のguardを出力する。
- `(function (Scratch) { ... })(Scratch);`のwrapperを付ける。
- minify後にheaderとpreludeを連結する。
- `Scratch.extensions.register(...)`の呼び出しを1つにする。
- 残存するmodule構文を拒否する。

テンプレートの責務です。

- プロジェクトの雛形。
- README生成の組み込み。
- block定義。
- 拡張機能manifestの生成。
- 生成された拡張機能packageのリポジトリpolicy。

設計とビルド契約は[docs/architecture.md](docs/architecture.md)を参照してください。拡張機能テンプレートが
生成block一覧を維持するために使えるライブラリAPIは[docs/readme-generation.md](docs/readme-generation.md)に
あります。

## 開発

```bash
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check`は、TypeScriptの型検査、単体テスト、packageのコンパイル、リポジトリpolicyの検証、
packageアーカイブの検証を実行します。

## リリース

versionのsource of truthは`package.json`です。このpackage versionに対するreleaseタグは`v0.9.0`と
一致する必要があります。

公開前に次を実行します。

```bash
pnpm run check
npm pack --dry-run --ignore-scripts
```

packageアーカイブには、コンパイル済みの`dist/`出力、型宣言、`docs/`、`README.md`、`LICENSE`を
含める必要があります。

## ライセンス

SPDX-License-Identifier: MPL-2.0
