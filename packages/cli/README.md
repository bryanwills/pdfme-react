# @pdfme/cli

pdfme のコマンドラインツール。テンプレート作成・検証・PDF生成・画像変換を CLI で完結できる。

## 背景と設計思想

### なぜ CLI が必要か

pdfme は PDF テンプレートを JSON で定義し、プログラマティックに PDF を生成するライブラリ。従来の開発フローは「Designer UI でテンプレート作成 → コードから `generate()` 呼び出し → ブラウザで結果確認」というサイクルだった。

AI エージェント（Claude Code 等）を使った開発では、このフローに根本的な課題がある:

- **エージェントはブラウザの Designer UI を操作できない**
- **エージェントは PDF ファイルを直接読めない** — 画像に変換する必要がある
- **テンプレート JSON の構造エラーを、PDF 生成を試みるまで検出できない**

`@pdfme/cli` はこれらを解決し、**AI エージェントが自律的にテンプレート作成から結果検証まで完結できるフィードバックループ**を構築する。

```
JSON 編集 → pdfme generate --image → PNG 読み取り → 視覚確認 → 微調整
```

### 設計原則

- **AI エージェント特化**: `--json` フラグで構造化出力、`--help` に豊富な使用例、エラーメッセージに修正案を含める
- **machine interface 優先**: `--json` 指定時は stdout を JSON のみに固定し、失敗時も構造化エラーを返す
- **日本語ユーザー対応**: CJK 文字を検出すると NotoSansJP を自動ダウンロード＆キャッシュし、解決不能時は structured error を返す
- **既存 PDF からのテンプレート作成ワークフロー**: `pdf2img` → `pdf2size` → テンプレート作成 → `generate --image` の一連フローをサポート
- **npx でもローカルでも同等の体験**

### pdfme v5 ロードマップにおける位置づけ

pdfme v5 メジャーバージョンアップは 3 フェーズで構成される:

| フェーズ | 内容 | 状態 |
|---------|------|------|
| Phase 1 | Vite / Vitest / Oxlint 移行、ESM-only 化 | **完了** |
| Phase 2 | `@pdfme/cli` | **本パッケージ** |
| Phase 3 | Claude Code Skills (`/pdfme-verify` 等) | 未着手 |

Phase 1 で全パッケージのビルドを Vite library mode + Vitest に統一した。Phase 2 の CLI はその基盤の上に構築され、Phase 3 の Skills が CLI コマンドを活用する。

---

## インストール

```bash
# プロジェクトに追加
npm install -D @pdfme/cli

# または npx で直接実行
npx @pdfme/cli generate --help
```

monorepo でローカルに試す場合は、build 後にエントリポイントを直接実行できる:

```bash
npm run build -w packages/cli
node packages/cli/dist/index.js --help
```

**要件**: Node.js 20 以上

---

## コマンド一覧

| コマンド | 用途 |
|---------|------|
| [`generate`](#pdfme-generate) | テンプレート + 入力データ → PDF + 画像 |
| [`validate`](#pdfme-validate) | テンプレート JSON の構造検証 |
| [`doctor`](#pdfme-doctor) | 実行環境 / job / template の事前診断 |
| [`pdf2img`](#pdfme-pdf2img) | 既存 PDF → 画像変換 (グリッド付き) |
| [`pdf2size`](#pdfme-pdf2size) | PDF のページサイズ取得 |
| [`examples`](#pdfme-examples) | 組み込みテンプレート資産の参照・出力 |

---

## pdfme generate

テンプレートと入力データから PDF を生成し、オプションで画像やグリッドオーバーレイも出力する。

### 使い方

```bash
# 分離形式: テンプレートと入力を別ファイルで指定
pdfme generate -t template.json -i inputs.json -o out.pdf

# 統合形式: { template, inputs, options? } を含む 1 ファイル
pdfme generate job.json -o out.pdf --image

# 既存 PDF をベースに、フィールドを重ねて生成
pdfme generate -t template.json --basePdf invoice.pdf -i inputs.json --image --grid

# JSON 出力 (AI/スクリプト向け)
pdfme generate job.json -o out.pdf --image --json
```

### オプション

| フラグ | 型 | デフォルト | 説明 |
|--------|------|-----------|------|
| `[file]` | positional | - | 統合ファイル (`{ template, inputs, options? }`) |
| `-t, --template` | string | - | テンプレート JSON ファイル |
| `-i, --inputs` | string | - | 入力データ JSON ファイル |
| `-o, --output` | string | `output.pdf` | 出力 PDF パス |
| `--force` | boolean | false | 暗黙の `output.pdf` 上書きを許可 |
| `--image` | boolean | false | 各ページの PNG 画像も出力 |
| `--imageFormat` | string | `png` | 画像フォーマット (`png` / `jpeg`) |
| `--scale` | string | `1` | 画像レンダリングスケール |
| `--grid` | boolean | false | グリッド＋スキーマ境界を画像にオーバーレイ |
| `--gridSize` | string | `10` | グリッド間隔 (mm) |
| `--font` | string | - | カスタムフォント (カンマ区切りで複数可: `"A=a.ttf,B=b.ttf"`) |
| `--basePdf` | string | - | basePdf をファイルパスで上書き |
| `--noAutoFont` | boolean | false | CJK フォント自動ダウンロードを無効化 |
| `-v, --verbose` | boolean | false | 詳細出力 |
| `--json` | boolean | false | 構造化 JSON 出力 |

`-v, --verbose` を付けると、入力 source、mode、template pages、input 数、output PDF、image 条件、font 前提、`--basePdf` override を stderr に出す。`--json` と併用しても stdout は JSON のまま維持される。

### `--json` 契約

`--json` を指定すると、成功時も失敗時も stdout には JSON のみを出力する。人間向けの補足や warning は stderr に寄せる。

成功例:

```json
{
  "ok": true,
  "command": "generate",
  "mode": "job",
  "templatePageCount": 1,
  "inputCount": 1,
  "pageCount": 1,
  "outputPath": "out.pdf",
  "outputBytes": 12345
}
```

失敗例:

```json
{
  "ok": false,
  "error": {
    "code": "EARG",
    "message": "Invalid value for --scale: expected a positive number, received \"nope\"."
  }
}
```

### 統合ファイル形式 (job.json)

```json
{
  "template": {
    "basePdf": { "width": 210, "height": 297, "padding": [20, 20, 20, 20] },
    "schemas": [
      [
        {
          "name": "title",
          "type": "text",
          "position": { "x": 20, "y": 20 },
          "width": 170,
          "height": 15,
          "fontSize": 24,
          "alignment": "center",
          "content": "Invoice",
          "readOnly": true
        },
        {
          "name": "customerName",
          "type": "text",
          "position": { "x": 20, "y": 50 },
          "width": 80,
          "height": 10
        }
      ]
    ]
  },
  "inputs": [
    { "customerName": "John Doe" }
  ],
  "options": {
    "font": {
      "NotoSansJP": {
        "data": "https://fonts.gstatic.com/...",
        "fallback": false,
        "subset": true
      }
    }
  }
}
```

テンプレート JSON 内の `basePdf` にはファイルパスも指定可能:

```json
{
  "basePdf": "./invoice.pdf",
  "schemas": [...]
}
```

### スキーマ型一覧

`text`, `multiVariableText`, `image`, `signature`, `svg`, `table`, `qrcode`, `ean13`, `ean8`, `code39`, `code128`, `nw7`, `itf14`, `upca`, `upce`, `japanpost`, `gs1datamatrix`, `pdf417`, `line`, `rectangle`, `ellipse`, `date`, `dateTime`, `time`, `select`, `radioGroup`, `checkbox`

### --grid の出力

`--grid` を指定すると、画像に以下がオーバーレイされる:

- **グリッド線**: `--gridSize` mm 間隔のグレー線
- **スキーマ境界**: 色付き破線矩形 (型ごとに色分け)
- **ラベル**: 各フィールドの `名前 (型)` を矩形左上に表示

### CJK フォント自動ダウンロード

`--font` 未指定時、テンプレートや入力データに CJK 文字 (日本語、中国語、韓国語) が含まれていると、NotoSansJP を自動的にダウンロードしてキャッシュする:

- キャッシュ場所: `~/.pdfme/fonts/NotoSansJP-Regular.ttf`
- オフラインで自動取得できず、明示的なフォント指定もない場合は structured error (`EFONT`) を返す
- `--noAutoFont` で無効化
- `--noAutoFont` 使用時に CJK が含まれ、明示的なフォント指定がなければ structured error (`EFONT`) を返す

### Font Source Contract

`@pdfme/cli` は「拡張子そのもの」ではなく、**どこからフォントを解決するか**を基準に contract を持つ。

- `--font name=path.ttf`
  - local file 専用
  - path は CLI 実行時の `cwd` 基準で解決
  - 現時点で強保証するのは `.ttf` のみ
  - 同名エントリが `options.font` にあっても `--font` を優先する
- `options.font.<name>.data`
  - local `.ttf` path
    - unified job / template JSON のあるディレクトリ基準で解決
  - public host を向く `https://...` / `http://...` の direct `.ttf` asset URL
    - `fonts.gstatic.com/...ttf` のような Google Fonts asset URL は official remote source として扱う
  - `.ttf` を表す `data:` URI
  - `Uint8Array` / `ArrayBuffer`
    - これは programmatic 入力では有効だが、純粋な JSON job では通常使わない
- implicit source
  - 常に default `Roboto`
  - CJK があり明示 font がなければ auto `NotoSansJP` (cache or download)

unsupported として fail-fast に寄せるもの:

- missing local font path
- `.otf` / `.ttc` など `.ttf` 以外を明示する source
- loopback / private host を含む unsafe `http(s)` URL
- `file:` / `ftp:` など非 `http(s)` URL
- `fonts.googleapis.com/css*` のような Google Fonts stylesheet API URL

現時点で未サポートのもの:

- Google Fonts の family / weight / style を declarative に解決する専用 surface
- CSS 経由で font binary を辿る remote font workflow

warning に留めるもの:

- public host の `http(s)` URL だが path に拡張子がなく raw `.ttf` asset と明示できない source
- `data:` URI だが media type から `.ttf` と明示できない source

`doctor fonts` はこの source contract をそのまま machine-readable に返し、`generate` は local path を事前解決して structured error に寄せる。

### Remote Font Runtime Contract

explicit remote font (`options.font.<name>.data = https://...`) は CLI 側で先に解決してから generator に渡す。

- `generate --json` では network failure / HTTP failure / timeout / size safety limit 超過を `EFONT` で返す
- error details には少なくとも `fontName`, `url`, `provider`, `timeoutMs`, `maxBytes` が入る
- current CLI が cache する remote font は implicit `NotoSansJP` のみ
- explicit remote font 用の cache / offline fallback workflow は current product surface に含めない
- remote fetch timeout は 15 秒
- remote fetch size limit は 32 MiB

失敗例:

```json
{
  "ok": false,
  "error": {
    "code": "EFONT",
    "message": "Failed to fetch remote font data from https://fonts.example.com/network-error.ttf. fetch failed",
    "details": {
      "fontName": "PinyonScript",
      "url": "https://fonts.example.com/network-error.ttf",
      "provider": "genericPublic",
      "timeoutMs": 15000,
      "maxBytes": 33554432
    }
  }
}
```

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 成功 |
| 1 | テンプレート/入力バリデーションエラー |
| 2 | runtime / font 解決エラー |
| 3 | ファイル I/O エラー |

---

## pdfme validate

テンプレート JSON の構造を検証する。`generate` の前に実行することで、エラーを早期発見できる。

### 使い方

```bash
pdfme validate template.json

# 統合 job をそのまま検証
pdfme validate job.json

# stdin から検証
cat template.json | pdfme validate - --json

# JSON 出力
pdfme validate template.json --json

# Warning もエラー扱いにする
pdfme validate template.json --strict

# 詳細出力を stderr に出す
pdfme validate template.json -v --json
```

### 検証項目

| カテゴリ | チェック内容 | レベル |
|----------|------------|--------|
| 構造 | Zod スキーマバリデーション | ERROR |
| 型 | フィールドの type が存在するスキーマ型か | ERROR |
| 重複 | 同一ページ内のフィールド名重複 | ERROR |
| 重複 | 異なるページ間の同名フィールド | WARNING |
| 位置 | フィールドがページ境界外にはみ出し | WARNING |
| basePdf | BlankPdf の場合、width/height/padding が妥当か | ERROR |
| unified job | `template` / `inputs` / `options` の形が `generate` に渡せるか | ERROR |
| top-level | 未知の top-level field | WARNING |

`validate` は template 単体だけでなく unified job (`{ template, inputs, options? }`) も受理する。`--strict` を付けると warning も exit code 1 に昇格する。
`-v, --verbose` を付けると、入力 source、mode、pages / fields、job 時の input 数、strict 条件、error / warning 件数を stderr に出す。`--json` と併用しても stdout は JSON のまま維持される。

`--json` では `inputHints` も返す。これにより field ごとの期待入力形式を事前に把握できる。たとえば `text` は plain string、`image` / `signature` / `svg` は `contentKind` 付き string、`table` は `string[][]` の nested JSON array、`date` / `time` / `dateTime` は `format` と `canonicalFormat` を持つ string、`select` / `checkbox` は constrained string enum、`radioGroup` は group-aware enum、`multiVariableText` は JSON string object を期待する。

```json
[
  {
    "name": "title",
    "type": "text",
    "pages": [1],
    "required": false,
    "expectedInput": { "kind": "string" }
  },
  {
    "name": "invoiceMeta",
    "type": "multiVariableText",
    "pages": [1],
    "required": true,
    "expectedInput": {
      "kind": "jsonStringObject",
      "variableNames": ["inv"],
      "example": "{\"inv\":\"INV\"}"
    }
  },
  {
    "name": "status",
    "type": "select",
    "pages": [1],
    "required": false,
    "expectedInput": {
      "kind": "enumString",
      "allowedValues": ["draft", "sent"],
      "example": "draft"
    }
  },
  {
    "name": "approved",
    "type": "checkbox",
    "pages": [1],
    "required": false,
    "expectedInput": {
      "kind": "enumString",
      "allowedValues": ["false", "true"],
      "example": "true"
    }
  },
  {
    "name": "lineItems",
    "type": "table",
    "pages": [1],
    "required": false,
    "expectedInput": {
      "kind": "stringMatrix",
      "columnCount": 3,
      "columnHeaders": ["Item", "Qty", "Price"],
      "example": [["Item value", "Qty value", "Price value"]],
      "acceptsJsonString": true
    }
  },
  {
    "name": "logo",
    "type": "image",
    "pages": [1],
    "required": false,
    "expectedInput": {
      "kind": "string",
      "contentKind": "imageDataUrl"
    }
  },
  {
    "name": "dueDate",
    "type": "date",
    "pages": [1],
    "required": false,
    "expectedInput": {
      "kind": "string",
      "format": "dd/MM/yyyy",
      "canonicalFormat": "yyyy/MM/dd",
      "example": "2026/03/28"
    }
  },
  {
    "name": "choiceA",
    "type": "radioGroup",
    "pages": [1],
    "required": false,
    "expectedInput": {
      "kind": "enumString",
      "allowedValues": ["false", "true"],
      "example": "true",
      "groupName": "choices",
      "groupMemberNames": ["choiceA", "choiceB"]
    }
  }
]
```

型名が不正な場合、Levenshtein 距離に基づく修正候補を提示する:

```
✗ Error: Field "title" has unknown type "textbox". Did you mean: text? Available types: text, image, ...
```

---

## pdfme doctor

`generate` 実行前に、CLI 実行環境や local job/template の準備状態を診断する。`validate` が JSON 構造中心なのに対し、`doctor` は basePdf path、font 前提、cache 状態も含めて見る。

### 使い方

```bash
# 実行環境の自己診断
pdfme doctor

# local job / template の診断
pdfme doctor job.json --json

# stdin から診断
cat job.json | pdfme doctor - --json

# font source 前提だけを診断
pdfme doctor fonts job.json --json

# generate --noAutoFont 相当の条件で診断
pdfme doctor job.json --noAutoFont --json

# generate の出力先 / 画像出力先まで事前診断
pdfme doctor job.json -o artifacts/out.pdf --image --imageFormat jpeg --json

# 詳細出力を stderr に出す
pdfme doctor job.json -v --json
```

### 何を返すか

- `pdfme doctor`
  - Node version / CLI version / platform / arch
  - `cwd` と temp dir の writable 状態
  - NotoSansJP cache file の存在と cache dir の writable 状態
- `pdfme doctor <job-or-template>`
  - `validate` 相当の pages / fields / errors / warnings
  - basePdf の種別と local path 解決結果
  - schema types / required official plugins / required fonts
  - CJK 検出時に auto-font が必要か、cache があるか、`--noAutoFont` だと blocking になるか
  - `generate` 相当の output path safety (`output.pdf` の implicit overwrite guard, writable dir, image output preview)
- `pdfme doctor fonts <job-or-template>`
  - `options.font` の source 種別 (`localPath` / `url` / `dataUri` / `inlineBytes` / `invalid`)
  - local font path の解決結果と存在確認
  - remote source ごとの `provider`, `needsNetwork`, `supportedFormat`
  - `.ttf` 以外の unsupported 検出
  - implicit default font / auto NotoSansJP を含む effective font 前提

runtime/path の事前診断には `generate` と同じく `-o, --output`, `--force`, `--image`, `--imageFormat` を使える。`doctor fonts` ではこれらの flag は font diagnosis の health/payload には反映しないが、argument validation 自体は通常どおり行う。
`-v, --verbose` を付けると、target、入力 source、mode、pages / fields、job 時の input 数、estimated pages、output PDF、image 条件、issue / warning 件数を stderr に出す。`--json` と併用しても stdout は JSON のまま維持される。

### `--json` 契約

`doctor` も `validate` と同様に、コマンド自体が実行できた場合は `ok: true` を返し、blocking issue の有無は `healthy` で表す。`target` は `environment` / `input` / `fonts` のいずれかになる。

font payload の `explicitSources` / `implicitSources` には `needsNetwork` が含まれるため、agent は「その source が今の環境で network 前提か」を事前判定できる。
同様に `inputHints` には field ごとの期待入力形式が含まれるため、`text` / `image` / `signature` / `svg` / `table` / `date` / `time` / `dateTime` / `select` / `checkbox` / `radioGroup` / `multiVariableText` の違いを generate 前に判定できる。

環境診断の例:

```json
{
  "ok": true,
  "target": "environment",
  "healthy": true,
  "environment": {
    "nodeVersion": "v20.19.3",
    "cliVersion": "0.1.0-alpha.0"
  },
  "issues": [],
  "warnings": []
}
```

input 診断の例:

```json
{
  "ok": true,
  "command": "doctor",
  "target": "input",
  "healthy": false,
  "mode": "template",
  "templatePageCount": 1,
  "fieldCount": 1,
  "estimatedPageCount": 1,
  "validation": {
    "valid": true,
    "pages": 1,
    "fields": 1,
    "errors": [],
    "warnings": []
  },
  "diagnosis": {
    "basePdf": { "kind": "pdfPath", "exists": false },
    "fonts": { "missingFonts": ["NotoSerifJP"] },
    "runtime": {
      "estimatedPages": 1,
      "output": {
        "path": "output.pdf",
        "resolvedPath": "/abs/path/output.pdf",
        "implicitDefaultProtected": true
      }
    }
  },
  "issues": [
    "Base PDF file not found: /abs/path/missing.pdf",
    "Refusing to overwrite implicit default output file: /abs/path/output.pdf. Use -o to choose an explicit path or --force to overwrite."
  ],
  "warnings": []
}
```

`image` / `signature` / `svg` では `kind = "string"` のまま、`contentKind` で `imageDataUrl` / `signatureImageDataUrl` / `svgMarkup` を返す。`table` では `inputHints.expectedInput.kind = "stringMatrix"` と `columnCount` / `columnHeaders` が返る。canonical input は `string[][]` の nested JSON array で、`acceptsJsonString: true` のときは後方互換として JSON string も受理する。`date` / `time` / `dateTime` では `format` と `canonicalFormat` が返る。`example` は current CLI が期待する canonical stored content 例で、`format` は schema 側の format ベースの hint を示す。`select` / `checkbox` では `inputHints.expectedInput.kind = "enumString"` と `allowedValues` が返る。`radioGroup` ではそれに加えて `groupName` / `groupMemberNames` が返り、同じ group 内で複数 field を `"true"` にすると `generate --json` / `validate --json` / `doctor --json` は `EVALIDATE` 相当で fail-fast する。`multiVariableText` では expected variable names と JSON string 例が返る。

### `multiVariableText` Input Contract

`multiVariableText` は plain string ではなく、変数名をキーに持つ **JSON string object** を期待する。

template:

```json
{
  "name": "invoiceMeta",
  "type": "multiVariableText",
  "text": "Invoice {inv}",
  "variables": ["inv"]
}
```

input:

```json
[
  {
    "invoiceMeta": "{\"inv\":\"INV-001\"}"
  }
]
```

plain string を渡すと、`generate --json` は `EVALIDATE` で fail-fast し、expected variable names と example を返す。

font 診断の例:

```json
{
  "ok": true,
  "target": "fonts",
  "healthy": false,
  "mode": "job",
  "diagnosis": {
    "fonts": {
      "requiredFonts": ["BrandOtf", "BrandTtf"],
      "explicitSources": [
        { "fontName": "BrandTtf", "kind": "localPath", "supportedFormat": true },
        { "fontName": "BrandOtf", "kind": "localPath", "supportedFormat": false }
      ]
    }
  },
  "issues": [
    "Font file for BrandOtf uses .otf. @pdfme/cli currently guarantees only .ttf custom fonts for BrandOtf."
  ],
  "warnings": []
}
```

blocking issue があれば exit code 1、argument / parse / file I/O 自体に失敗した場合は他 command と同様に structured error (`ok: false`) を返す。

---

## pdfme pdf2img

既存 PDF を画像に変換する。テンプレート作成時にレイアウトを確認したり、basePdf の内容を可視化するのに使う。

### 使い方

```bash
# 基本
pdfme pdf2img invoice.pdf

# グリッド付き (mm 座標ラベルも表示)
pdfme pdf2img invoice.pdf --grid --gridSize 10

# 特定ページのみ
pdfme pdf2img invoice.pdf --pages 1-2

# 詳細出力を stderr に出す
pdfme pdf2img invoice.pdf -o ./images/ --verbose

# 出力先指定 + JSON (サイズ情報付き)
pdfme pdf2img invoice.pdf -o ./images/ --json
```

`-o, --output` は **ディレクトリ専用**。`page-%d.png` や単一ファイル名はサポートしない。
`-v, --verbose` を付けると、入力、ページ数、対象ページ、出力先、format、scale、grid 条件を stderr に出す。`--json` と併用しても stdout は JSON のまま維持される。

### `--json` 出力

```json
{
  "ok": true,
  "command": "pdf2img",
  "pageCount": 1,
  "selectedPageCount": 1,
  "outputDir": "./images",
  "outputPaths": ["invoice-1.png"],
  "pages": [
    { "outputPath": "invoice-1.png", "pageNumber": 1, "width": 210, "height": 297 }
  ]
}
```

---

## pdfme pdf2size

PDF のページサイズ (mm) を取得する。A4, Letter 等の標準サイズ名も自動判定。

```bash
$ pdfme pdf2size invoice.pdf
Page 1: 210 × 297 mm (A4 portrait)

$ pdfme pdf2size invoice.pdf --json
{
  "ok": true,
  "command": "pdf2size",
  "pageCount": 1,
  "pages": [{ "pageNumber": 1, "width": 210, "height": 297 }]
}
```

`-v, --verbose` を付けると、入力とページ数を stderr に出す。`--json` と併用しても stdout は JSON のまま維持される。

---

## pdfme examples

`https://playground.pdfme.com/template-assets/` で配信しているテンプレート資産を参照・出力する。AI エージェントがテンプレートを新規作成する際の構造参考として使える。

### 使い方

```bash
# テンプレート一覧
pdfme examples --list

# テンプレートを stdout に出力
pdfme examples invoice

# ファイルに出力
pdfme examples invoice -o template.json

# テンプレート + サンプル入力を統合形式で出力
pdfme examples invoice --withInputs -o job.json

# 構造化 JSON で metadata も取得
pdfme examples --list --json

# source と output 条件を stderr に出す
pdfme examples invoice --withInputs -o job.json -v --json

# そのまま generate に渡せる
pdfme examples invoice --withInputs -o job.json && pdfme generate job.json --image
```

`--withInputs` で出力する job には、必要に応じて `options.font` が含まれる。official examples が使用するフォント URL を同梱するため、template 側の `fontName` と `generate` の入力契約がずれにくい。

### 組み込みテンプレート

利用可能なテンプレートは `pdfme examples --list` で取得。

`--json` を付けると manifest metadata も返す。manifest には `path`, `thumbnailPath`, `pageCount`, `fieldCount`, `schemaTypes`, `fontNames`, `hasCJK`, `basePdfKind` などが含まれ、AI/agent が examples を探索しやすい形になっている。
`-v, --verbose` を付けると、base URL、manifest source / URL、template source / URL、mode、output 先を stderr に出す。`--json` と併用しても stdout は JSON のまま維持される。

---

## 典型的ワークフロー

### 1. ゼロからテンプレートを作る (AI エージェント向け)

```bash
# 1. 既存テンプレートを参考に構造を把握
pdfme examples invoice --withInputs -o job.json

# 2. job.json を編集してテンプレートを作成

# 3. generate 前に doctor で前提を確認
pdfme doctor job.json --json

# 4. 生成して結果を画像で確認
pdfme generate job.json -o out.pdf --image

# 5. 画像を確認 → JSON を微調整 → 3 に戻る
```

### 2. 既存 PDF にフィールドを追加する

```bash
# 1. 既存 PDF のレイアウトを画像で確認
pdfme pdf2img invoice.pdf --grid --gridSize 10

# 2. ページサイズを確認
pdfme pdf2size invoice.pdf --json

# 3. テンプレート JSON を作成 (basePdf にファイルパスを指定)
cat > template.json << 'EOF'
{
  "basePdf": "./invoice.pdf",
  "schemas": [[
    {
      "name": "amount",
      "type": "text",
      "position": { "x": 120, "y": 200 },
      "width": 60, "height": 10,
      "fontSize": 14, "alignment": "right"
    }
  ]]
}
EOF

# 4. 入力データを作成
echo '[{ "amount": "¥1,234,567" }]' > inputs.json

# 5. 生成前に path / font / basePdf を診断
pdfme doctor template.json -o out.pdf --image --json

# 6. 生成して結果をグリッド付き画像で確認
pdfme generate -t template.json -i inputs.json -o out.pdf --image --grid

# 7. 画像を確認 → テンプレートを微調整 → 5 に戻る
```

### 3. CI/CD でのテンプレート検証

```bash
# テンプレートの構造エラーをチェック (Warning もエラー扱い)
pdfme validate template.json --strict --json
```

---

## アーキテクチャ

### ディレクトリ構成

```
packages/cli/
├── src/
│   ├── index.ts              # エントリポイント + コマンドルーター
│   ├── commands/
│   │   ├── generate.ts       # PDF 生成 + 画像出力
│   │   ├── validate.ts       # テンプレート検証
│   │   ├── doctor.ts         # 環境 / font / runtime 診断
│   │   ├── pdf2img.ts        # PDF → 画像変換
│   │   ├── pdf2size.ts       # ページサイズ取得
│   │   └── examples.ts       # テンプレート資産参照
│   ├── contract.ts           # 共通 error / JSON / 引数契約
│   ├── diagnostics.ts        # validate / doctor 用 inspection
│   ├── schema-plugins.ts     # 公式 plugin の自動収集
│   ├── grid.ts               # グリッド / スキーマ境界オーバーレイ描画
│   ├── fonts.ts              # フォント読込 + CJK 自動 DL + キャッシュ
│   ├── example-templates.ts  # current official manifest / template 取得
│   ├── example-fonts.ts      # official examples 用 font URL 埋め込み
│   ├── cjk-detect.ts         # CJK 文字検出
│   ├── version.ts            # ビルド時注入の CLI version
│   └── utils.ts              # ファイル I/O, 入力形式判定, 用紙サイズ検出
├── __tests__/
├── package.json
├── vite.config.mts           # target: node20, ESM, shebang 付きビルド
├── tsconfig.json             # typecheck 用 (composite)
└── tsconfig.build.json       # declaration emit 用
```

### 依存関係

```
@pdfme/cli
├── @pdfme/common      # 型定義, フォント, バリデーション
├── @pdfme/schemas     # ビルトインスキーマプラグイン (text, image, table, ...)
├── @pdfme/generator   # PDF 生成エンジン
├── @pdfme/converter   # PDF ↔ 画像変換 (内部で @napi-rs/canvas 使用)
└── citty              # CLI パーサー (UnJS 製, ゼロ依存, サブコマンド対応)
```

### ビルド

```bash
npm run build -w packages/cli
# = vite build (→ dist/index.js, ESM, shebang 付き)
# + tsc -p tsconfig.build.json (→ dist/*.d.ts)
```

Vite で `target: node20`, 全依存を external にして単一 `dist/index.js` を出力。`@napi-rs/canvas` 等のネイティブモジュールはバンドルに含めない。

---

## 既知の制限事項

- **フォント複数指定**: citty が repeated string args を未サポートのため、カンマ区切り形式 (`--font "A=a.ttf,B=b.ttf"`) を使用
- **カスタムフォント source contract**: 現時点の強保証は local path / `http(s)` URL / `data:` URI の `.ttf`。`.otf` / `.ttc` は unsupported error を返す
- **explicit remote font cache**: current CLI は explicit remote font を保存しない。offline 前提にしたい場合は local `.ttf` か `data:` URI を使う
- **Google Fonts stylesheet API**: `fonts.googleapis.com/css*` は supported source ではない。direct font asset URL を使う
- **examples コマンド**: current の official manifest / template を network 越しに取得する convenience command。取得先は `PDFME_EXAMPLES_BASE_URL` 環境変数で上書き可能
- **NotoSansJP の DL URL**: Google Fonts CDN の可変ウェイトフォント (~16MB) を使用。固定ウェイト版への切り替えでサイズ削減可能

## 次の検討トラック

- command 間 UX parity の見直し: `--verbose` second pass は `generate` / `validate` / `doctor` / `examples` まで拡張済み。次は verbose 以外の flag / payload / human-readable surface を見直す
- input discoverability の改善: `multiVariableText` の期待入力形式を `doctor` / `validate --json` から見つけやすくする
- docs / examples polish: `basePdf` overlay workflow と agent 向け onboarding の discoverability を上げる
- Separate track: Rich Text / Markdown Authoring。CLI hardening とは別に spec から進め、Markdown/Rich Text で本文 PDF を作ってから pdfme template overlay を後段で重ねる workflow を主ユースケースに置く
