# CLI

`@pdfme/cli` は、JSON-first な pdfme workflow のためのコマンドライン surface です。

主な用途:

- custom Node script を書かずにローカルで template を反復調整する
- `generate` 実行前に CI で前提条件を確認する
- machine-readable な出力を必要とする agent workflow を回す
- 既存 PDF の上に field を重ねる `basePdf` overlay workflow を使う

## インストール

Node.js 20 以降が必要です。

```bash
npm install -D @pdfme/cli
```

`npx` から直接実行することもできます。

```bash
npx @pdfme/cli generate --help
```

## 主なコマンド

- `pdfme generate`
  - template + inputs または unified job から PDF を生成する
  - `--image` でページ画像も出力できる
  - `--grid` でグリッドと schema 境界を画像に重ねられる
  - `--verbose` で input/output/render 条件を stderr に出せる。`--json` の stdout は汚さない
- `pdfme validate`
  - generate 前に template または unified job を検証する
  - machine-readable な inspection には `--json` を使う
  - `--verbose` で source / mode / 件数サマリを stderr に出せる
- `pdfme doctor`
  - generate 前に runtime, font, `basePdf`, cache, output path の問題を診断する
  - `--verbose` で target / input / runtime のサマリを stderr に出せる
- `pdfme pdf2img`
  - 既存 PDF をページ画像に変換する
  - `--verbose` で source/output/render 条件を stderr に出せる。`--json` の stdout は汚さない
- `pdfme pdf2size`
  - ページサイズをミリメートル単位で確認する
  - `--verbose` で source と総ページ数を stderr に出せる
- `pdfme examples`
  - official examples を参照し、必要なら sample input 付き unified job として出力する
  - `--verbose` で manifest / template source と output 先を stderr に出せる

## 典型的な workflow

official example から始め、runtime 前提を診断し、画像を出して目視確認する流れです。

```bash
pdfme examples invoice --withInputs -o job.json
pdfme doctor job.json --json
pdfme generate job.json -o out.pdf --image --grid
```

CLI は human-readable な出力だけでなく structured JSON も返せるため、agent や CI に向いています。

## 既存 PDF への overlay workflow

既存 PDF の上に text, date, signature などの field を重ねたい場合:

```bash
pdfme pdf2img invoice.pdf --grid --gridSize 10
pdfme pdf2size invoice.pdf --json
pdfme doctor template.json -o out.pdf --image --json
pdfme generate -t template.json -i inputs.json -o out.pdf --image --grid
```

この flow では template の `basePdf` に既存 PDF を指定し、pdfme は overlay field だけを描画します。

## Machine-Readable Contract

`--json` を付けると:

- stdout は JSON のみになる
- `--verbose` の補足情報は stderr に出る
- failure は `ok: false` の structured error を返す
- `doctor` は command 自体が動けば `ok: true` を返し、blocking issue の有無は `healthy` で表す
- `validate --json` / `doctor --json` は field-level の `inputHints` も返すため、plain string、`format` metadata を持つ date/time string、制約付き string enum、group-aware enum、JSON string object のどれを期待する field かを事前判定できる

そのため、CLI は automation、agent、CI gate に向いています。

たとえば date 系では `format` と `canonicalFormat` が、`select` / `checkbox` では enum 形式の `allowedValues` が、`radioGroup` ではそれに加えて `groupName` / `groupMemberNames` が、`multiVariableText` では expected variable names と sample JSON string payload が返ります。

## Font Contract

CLI はフォントを「拡張子の慣習」ではなく source contract として扱います。

対応する入力:

- `--font` 経由の local `.ttf` path
- unified job `options.font` 内の local `.ttf` path
- public な direct `http(s)` font asset URL
- `.ttf` data URI
- programmatic use での inline bytes

現行 policy:

- `fonts.gstatic.com/...ttf` の direct URL は supported remote source
- `fonts.googleapis.com/css*` の stylesheet URL は unsupported
- unsafe/private/loopback な font URL は reject
- `.otf` と `.ttc` は current contract の外

CJK を含む場合、`--noAutoFont` を付けない限り、CLI は `NotoSansJP` を自動解決して cache できます。

## Remote Font Runtime Safety

explicit remote font は generator に渡す前に CLI 側で解決されます。

- timeout: 15 秒
- size limit: 32 MiB
- network/HTTP/timeout/size-limit failure は `EFONT` で返す

`pdfme doctor fonts ... --json` の font diagnosis には各 source の `needsNetwork` が含まれるため、その job が network 前提かを事前に判定できます。

## 詳細

完全な command reference、examples、現行実装の補足は package README を参照してください。

- [`packages/cli/README.md`](https://github.com/pdfme/pdfme/blob/main/packages/cli/README.md)
