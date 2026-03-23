# pdfme AI駆動開発基盤 — 実装計画書 v2

## Context

pdfme開発における2つのボトルネック:
1. **ビルド/テストが遅い** — tsc×18回ビルド、Jest + ts-jest変換、ESLint（JS製）
2. **変更検証が遅い** — エージェントがPDF出力を自律的に検証できない

本計画は4フェーズで解決する:
- **Phase 0**: 互換性方針の確定（破壊的変更の整理）
- **Phase 1**: Vite / Vitest / Oxlint 移行でビルド/テスト/リントを高速化
- **Phase 2**: @pdfme/cli でエージェントの自律的PDF検証ループを構築
- **Phase 3**: Claude Code Skills で繰り返しワークフローを自動化

> 注 (2026-03-21 JST): 本計画策定時は Vite+ 待ちの前提だったが、現状の repo では
> `vp` を task runner / lint / fmt の front door として先行採用済み。
> ただし build/test の実体は引き続き package-local の Vite / Vitest 構成を使う。
> `vp lint` の型認識ルールは現状の tsconfig 事情と相性課題があるため、型検証は `tsc -b` を継続する。

---

# Phase 0: 互換性方針の確定

Phase 1着手前に、以下の破壊的変更方針を確定しドキュメント化する。

## 0.1 Breaking Changes一覧

| 変更 | 影響範囲 | 移行ガイド |
|------|---------|-----------|
| **ESM-only化**（CJS/UMD廃止） | `require('@pdfme/...')` を使う全ユーザー | `require()` → `import` への書き換え手順 |
| **Node 20+最低要件** | Node 16/18ユーザー | Node 20 LTSへの更新案内 |
| **React 18+**（UIパッケージ） | React 16/17ユーザー | React 18への更新案内 |
| **dist内部パス廃止** | `@pdfme/*/dist/cjs/src/...` を直接importするユーザー | package exports のみを使用するよう変更 |

## 0.2 サポートポリシー

| 項目 | 方針 |
|------|------|
| **ランタイム** | Node 20+（ランタイム最低要件） |
| **ブラウザ** | 引き続きサポート（es2020ターゲット） |
| **ビルドターゲット** | ブラウザ向けパッケージ: `es2020` / Node専用パッケージ（CLI）: `node20` |
| **React** | 18+（UIパッケージ、React 16サポート廃止） |
| **モジュール形式** | ESM-only（CJS/UMD廃止） |

## 0.3 事前準備タスク

1. [ ] GitHub DiscussionまたはIssueで方針を事前告知
2. [ ] マイグレーションガイドのドラフト作成
3. [ ] `playground/node-playground/generate.js` をESMに書き換え（`require` → `import`）
4. [ ] `packages/common/set-version.js` を ESMに書き換え（`require` → `import`）、または `.cjs` にリネーム
5. [ ] README / docs / website の更新対象ページを洗い出し

---

# Phase 1: Vite / Vitest / Oxlint 移行（メジャーバージョンアップ）

> Status (2026-03-20 JST): 実装完了。詳細な実施内容と実測検証結果は `PROGRESS.md` を参照。
> 補足: 1.7 の「playground Jest テストは Phase 1 では維持」は実装時に supersede され、playground も Vitest へ移行済み。

## 1.1 移行の全体像

| 要素 | 現在 | 移行後 |
|------|------|--------|
| ビルド | tsc × 18回（CJS/ESM/Node） | Vite library mode × 8（ESM-only） |
| 型生成 | tscビルドに内包 | `tsc --emitDeclarationOnly`（ビルドと分離） |
| 型チェック | ビルドに内包 | `tsc -b`（project references） |
| テスト | Jest 29 + ts-jest | Vitest 4（ESMネイティブ） |
| リント | ESLint 9 + @typescript-eslint | `vp lint`（Oxlint native）+ `tsc -b` |
| フォーマット | Prettier | `vp fmt`（Oxfmt native） |
| 設定ファイル | 36 | 約12 |
| 出力 | CJS + ESM + Node（26.5MB） | ESM-only（~9MB） |

## 1.2 追加する開発依存パッケージ（ルート）

```
vite                         # ビルドツール
vitest                       # テストフレームワーク
vite-plus                    # task runner / lint / fmt の統合 front door
```

パッケージ別:
```
vitest-image-snapshot       # generator, manipulator用
vitest-canvas-mock          # ui用
```

**vite-plugin-dts は使用しない。** モノレポでのrootDir問題があるため、型定義は `tsc --emitDeclarationOnly` で生成（UIパッケージの既存パターンと同じ）。

## 1.3 削除する開発依存パッケージ

```
jest, ts-jest, ts-jest-resolver, jest-environment-jsdom
jest-image-snapshot, jest-canvas-mock, @types/jest
```

**現状の lint 方針:**
- syntax / React hooks / Vitest 系は `vp lint` + `.oxlintrc.json` に集約
- format は `vp fmt` + `.oxfmtrc.json` に集約
- 型認識 lint は `vp lint` へ完全移行せず、当面は `tsc -b` を gate として維持

## 1.4 型解決戦略: Project References + composite

### ルート tsconfig.json

```jsonc
{
  "files": [],
  "references": [
    { "path": "packages/pdf-lib" },
    { "path": "packages/common" },
    { "path": "packages/converter" },
    { "path": "packages/schemas" },
    { "path": "packages/generator" },
    { "path": "packages/manipulator" },
    { "path": "packages/ui" }
  ]
}
```

### 各パッケージの tsconfig.json

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "declaration": true,
    "declarationDir": "dist",
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2020"
  },
  "include": ["src"],
  "references": [
    // 依存する他のpdfmeパッケージを列挙
  ]
}
```

### tsconfig.base.json の修正

```diff
- "types": ["node", "jest"]
+ "types": ["node"]
```

Vitestの型は `/// <reference types="vitest/globals" />` で解決。

## 1.5 ルートレベルの変更

### package.json

```jsonc
{
  "type": "module",
  "workspaces": [
    "packages/pdf-lib", "packages/common", "packages/converter",
    "packages/schemas", "packages/generator", "packages/manipulator", "packages/ui"
  ],
  "scripts": {
    "clean": "vp run --filter '@pdfme/*' clean",
    "build": "npm run build:pdf-lib && npm run build:common && npm run build:converter && npm run build:schemas && run-p build:generator build:ui build:manipulator",
    "build:pdf-lib": "npm run build -w packages/pdf-lib",
    "build:common": "npm run build -w packages/common",
    "build:converter": "npm run build -w packages/converter",
    "build:schemas": "npm run build -w packages/schemas",
    "build:generator": "npm run build -w packages/generator",
    "build:manipulator": "npm run build -w packages/manipulator",
    "build:ui": "npm run build -w packages/ui",
    "test": "vp run --filter '@pdfme/*' test",
    "test:watch": "vitest",
    "lint": "vp run --filter '@pdfme/*' lint && npm run lint --prefix playground",
    "typecheck": "tsc -b",
    "fmt": "vp run --filter '@pdfme/*' fmt && npm run fmt:playground && npm run fmt:meta"
  }
}
```

**重要な変更点:**
- `build:*` は `npm run build -w packages/xxx`（prebuild等のlifecycle維持）
- 並列ビルドは `run-p`（npm-run-all2維持、`&`+`wait`はWindows非対応）
- `typecheck` は `tsc -b`（project references）

### vitest.config.ts（ルート）

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/common', 'packages/pdf-lib', 'packages/converter',
      'packages/schemas', 'packages/generator', 'packages/manipulator', 'packages/ui',
    ],
  },
});
```

> `vitest.workspace.ts` と `defineWorkspace` はVitest 3.2で非推奨。Vitest 4では `projects` が正式API。

### 型認識 lint の扱い

現状は `eslint.typecheck.config.mjs` ではなく `tsc -b` を gate とする。
`vp lint` の type-aware lint が現行 tsconfig 構成と両立できるようになった段階で再評価する。

## 1.6 パッケージ別移行

### 各パッケージ共通パターン

**vite.config.ts（ブラウザ向け）:**
```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    outDir: 'dist',
    rollupOptions: { external: [/* 依存 */] },
    target: 'es2020',  // ← ブラウザ向け（node20はCLIのみ）
    minify: false, sourcemap: true,
  },
  test: { globals: true, environment: 'node' },
});
```

**package.json build:**
```jsonc
{
  "scripts": {
    "build": "vite build && tsc --emitDeclarationOnly",
    "dev": "vite build --watch"
  }
}
```

**exports（TypeScript解決順序）:**
```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",  // ← typesを最初に（TS解決優先）
      "import": "./dist/index.js"
    }
  }
}
```

### image snapshot移行（manipulator, generator）

**vitest.setup.ts（正しいAPI）:**
```typescript
import { imageMatcher } from 'vitest-image-snapshot';
imageMatcher();
// ※ expect.extend({ toMatchImageSnapshot }) ではない
```

**テストコード:**
```diff
- expect(images[i]).toMatchImageSnapshot({ customSnapshotIdentifier: `${name}-${i}` });
+ await expect(images[i]).toMatchImage(`${name}-${i}`);
```

### converter: pdfjs-dist v4アップグレード + export map

**pdfjs-dist v3→v4:** UMD→ESM native。importパス変更あり、事前調査必要。

**export map（types top-level配置）:**
```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.node.d.ts",
      "browser": { "types": "./dist/index.browser.d.ts", "import": "./dist/index.browser.js" },
      "node": { "import": "./dist/index.node.js" },
      "default": { "import": "./dist/index.browser.js" }
    }
  }
}
```

### schemas: マルチエントリ

```typescript
// vite.config.ts
entry: { index: 'src/index.ts', utils: 'src/utils.ts' },
// manualChunksを無効化して不要なchunk生成を防止
rollupOptions: { output: { manualChunks: undefined } },
```

### Jest→Vitest 移行チェックリスト

各パッケージで:
- [ ] `jest.fn()` → `vi.fn()`
- [ ] `jest.spyOn()` → `vi.spyOn()`
- [ ] `jest.mock()` → `vi.mock()`
- [ ] `jest.clearAllMocks()` → `vi.clearAllMocks()`
- [ ] `jest.Mock` 型 → `Mock` from vitest
- [ ] `@jest-environment` pragma → Vitest `environment`
- [ ] `__mocks__/*.js` → `.ts`（type:module対応）
- [ ] `require()` in tests → `import`
- [ ] `moduleNameMapper` → `resolve.alias`
- [ ] `toMatchImageSnapshot` → `imageMatcher()` + `toMatchImage()`
- [ ] snapshot再生成: `vitest run --update`

## 1.7 Playground 移行（正式タスク）

1. [ ] `file:../packages/*/dist` → `file:../packages/*`
2. [ ] `node-playground/generate.js` ESM化
3. [ ] `scripts/generate-templates-thumbnail.mjs` 内部パスimport廃止
4. [x] playground lint を `vp lint` ベースへ移行
5. [x] playground も Vitest へ移行

## 1.8 CI/CD

```yaml
- run: npm ci
- run: npm run fmt:check
- run: npm run lint
- run: npm run typecheck
- run: npm run build
- run: npm run test
```

## 1.9 工数見積もり

| 作業 | 見積もり |
|------|---------|
| Phase 0: 互換性方針 + 事前準備 | 1日 |
| common + manipulator | 2日 |
| converter（pdfjs-dist v4含む）+ schemas | 3日 |
| generator | 1-2日 |
| ui | 2-3日 |
| pdf-lib（最大リスク） | 3-4日 |
| playground移行 + CI更新 | 2日 |
| **合計** | **14-17日** |

---

# Phase 2: @pdfme/cli（contract-grade machine interface, ESM-only）

> Status (2026-03-23 JST): `packages/cli` のプロトタイプ実装自体は存在するが、
> 外部評価レポートとソース確認を踏まえて、Phase 2 の主目的を再定義した。
> ここで最優先すべきなのはコマンド面の拡張ではなく、CLI を
> **agent / CI / human が共通に使える contract-grade machine interface にすること**。

## 2.1 Product Positioning

`@pdfme/cli` は「ライブラリ周辺の便利ツール」ではなく、pdfme v5 の
**machine interface** として扱う。

到達したい姿:

- エージェントが template JSON を編集し、`generate` / `validate` / `pdf2img` / `pdf2size`
  を繰り返し呼び出して自律検証できる
- 人間と CI が同じ exit code / JSON contract を共有できる
- 将来的な markdown plugin / `md2pdf` も、この CLI 契約の上に積める

したがって、Phase 2 の完了条件は「コマンドが増えたこと」ではなく、
**examples / JSON / font/plugin / fetch/cache / E2E が壊れないこと** に置く。

## 2.2 Phase 2A のスコープ: Contract Hardening

Phase 2A では、既存コマンドの契約を固定する。

対象コマンド:

- `pdfme generate`
- `pdfme validate`
- `pdfme pdf2img`
- `pdfme pdf2size`
- `pdfme examples`

Phase 2A の間は、以下のような「surface area を広げる新機能」は止める。

- `inspect`
- `list-schemas`
- `schema-info`
- `template create`
- `template add-field`
- `doctor`
- markdown plugin の CLI 露出
- `md2pdf`

ただし、以下は継続して進めてよい。

- バグ修正
- 契約整理
- テスト追加
- ドキュメント更新
- 内部リファクタ

## 2.3 Phase 2 Exit Criteria

Phase 2 は、少なくとも以下が満たされた時点で完了とみなす。

1. `playground/public/template-assets/index.json` に載る公式 examples は、すべて CLI で generate 成功する
2. `examples` は `remote fetch + local cache + versioned manifest` を持つ
3. `--json` 指定時は、成功失敗を問わず stdout は常に JSON のみ
4. unknown flag / invalid enum / invalid number / invalid page range は全コマンドで fail-fast + non-zero
5. `validate` は template-only / unified job / stdin を受ける
6. `validate --strict` は warning をすべて exit 1 に昇格できる
7. CLI では公式 plugin をすべて使用できる（`signature` を含む）
8. フォント契約は明示され、unsupported format/resource は internal crash ではなく structured error になる
9. `pdf2img -o` の意味は directory-only に固定され、help / docs と実装が一致している
10. `output.pdf` の暗黙出力は安全策付きで扱われる
11. `generate` / `validate` / `pdf2img` / `pdf2size` はオフラインで成立する
12. examples / invalid args / JSON failure / offline behavior / font-plugin behavior を CI で検証する
13. user-facing version 表示が `0.0.0` 固定ではない

## 2.4 Command Surface in the Stabilization Tranche

| コマンド | Phase 2Aで固める契約 |
|---------|----------------------|
| `pdfme generate` | unified/split/stdin、JSON envelope、fail-fast validation、font/plugin resolution、overwrite policy |
| `pdfme validate` | template-only/unified/stdin、warning/error分離、`--strict`、JSON envelope |
| `pdfme pdf2img` | directory-only `-o`、strict arg validation、JSON envelope、PDF parse error sanitization |
| `pdfme pdf2size` | JSON envelope、PDF parse error sanitization、paper size detection |
| `pdfme examples` | remote fetch + local cache + versioned manifest、shared playground assets、metadata-aware listing |

## 2.5 Examples Asset Contract

`examples` と `playground` は **同じ資産を共有** する。
ただし、「公式 examples」として manifest に載るものは、必ず CLI 契約を満たす必要がある。

さらに、examples は単なるデモではなく、今後継続的に拡充していく
**pdfme のテンプレート資産** として扱う。
この資産は次の用途を持つ。

- ユーザー向けの onboarding / starter templates
- AI / agent による template 生成・改善時の参照ベース
- 将来的な RAG / 検索 / 推薦の対象
- CLI / playground / CI の回帰テスト資産

したがって、examples の拡充は Phase 2 のスコープ外ではなく、
**contract を壊さずに資産価値を積み上げる継続投資** とみなす。

つまり、近いうちは:

- playground 側の公式 examples を CLI で成功する font/plugin 制約に合わせて修正する
- CLI 側が後追いで何でも吸収するより、manifest に載る assets を contract-first に整える

manifest には少なくとも次の情報を持たせる。

- `name`
- `author`
- `version`
- `description`
- `pageCount`
- `requiresFonts`
- `requiresPlugins`
- `digest`

`examples --list` / `examples --json` はこの metadata を返せるようにする。

将来的には、template の検索性・再利用性を高めるため、次のような metadata 追加も検討する。

- `tags`
- `category`
- `locale`
- `industry`
- `layoutHints`
- `searchText`

## 2.6 Examples Fetch / Cache / Versioning

examples は bundle しない。理由は:

- CLI package size を抑えたい
- examples は今後増やしたい
- playground と共有したい

この方針は、「examples を継続的に増やして資産化する」方向とも整合する。
bundle ではなく remote + cache にすることで、CLI の軽さを保ちながら
template 資産の拡充速度を上げられる。

その代わり、次を正式仕様とする。

- examples は remote fetch する
- 初回取得後は local cache を使う
- manifest は versioned である
- CLI は自分の version に対応する manifest を見に行く
- `--latest` は opt-in

これにより、fetch 前提と machine reproducibility を両立する。

## 2.7 Font Policy

短期方針:

- 強保証する format は `ttf` のみ
- `otf` は当面 unsupported error
- `ttc` は当面 unsupported error
- auto-download を強く保証するのは `NotoSansJP` のみ

中長期方針:

- playground examples で使う font は、できるだけ Google Fonts にある family に寄せる
- 将来的に auto-download を広げる場合でも、任意フォント名の自由取得はしない
- manifest で allowlist された family のみ取得・キャッシュする

重要なのは、font 問題を「たまたま動く」ではなく
**contract と structured error で管理する** こと。

## 2.8 Plugin Policy

CLI は **公式 plugin をすべて使える状態** を目指す。

短期的に必要なこと:

- `signature` を公式スコープに含める
- playground examples が要求する plugin を CLI registry で解決できるようにする
- unsupported plugin は generate 前に structured error を返す

## 2.9 Machine-Readable Contract

`--json` 指定時は、全コマンドで stdout を JSON のみに固定する。
human-readable な補足は stderr に寄せる。

推奨 envelope:

```json
{
  "ok": true,
  "command": "generate",
  "exitCode": 0,
  "data": {}
}
```

```json
{
  "ok": false,
  "command": "generate",
  "exitCode": 2,
  "error": {
    "code": "FONT_NOT_FOUND",
    "message": "NotoSansJP is required by template.schemas",
    "details": {}
  }
}
```

合わせて、以下も固定する。

- unknown flag は error
- invalid enum は error
- invalid number は error
- invalid page range は error
- parse failure は JSON で返す

## 2.10 Input / Output Semantics

### `validate`

- template-only JSON を受ける
- unified job JSON を受ける
- stdin を受ける
- unknown top-level field / ignored field は warning
- `--strict` は warning 全部を exit 1

### `pdf2img -o`

- 当面は directory-only に固定する
- help / README / 実装を一致させる
- 1ページ単体ファイルや pattern 出力が必要なら、将来 `--output-file` / `--output-pattern` を別フラグで追加する

### overwrite policy

- 明示した `-o` は上書き可
- 暗黙の `output.pdf` だけは、既存ファイルがあれば失敗させて `-o` か `--force` を促す

## 2.11 Offline Policy

- `examples` 初回取得は network を要求してよい
- ただし cache 済み examples は offline でも使えるべき
- `generate` / `validate` / `pdf2img` / `pdf2size` は examples とは独立にオフラインで成立するべき

## 2.12 Test / Release Gates

CI で最低限次を回す。

- official examples 全件 `examples -> generate`
- invalid option matrix
- `--json` success/failure snapshot
- font/plugin dependency matrix
- offline lane (`examples` 以外)
- malformed PDF / malformed JSON の error sanitization

これらを通るまで、Phase 2A は完了扱いにしない。

## 2.13 Deferred Until After Phase 2A

以下は contract hardening 完了後に再評価する。

- `inspect`
- `list-schemas`
- `schema-info`
- `template create`
- `template add-field`
- `doctor`
- markdown plugin の CLI 露出
- `md2pdf`

`doctor` は有力候補だが、今は surface 拡張より contract 固定を優先する。

## 2.14 package.json / Versioning

```jsonc
{
  "name": "@pdfme/cli",
  "type": "module",
  "bin": { "pdfme": "dist/index.js" },
  "engines": { "node": ">=20" }
}
```

追加方針:

- user-facing version は `0.0.0` 固定にしない
- workspace 中でも package version を表示する
- 必要なら dev suffix を付ける

## 2.15 工数見直し

旧見積もりの「7-8日」は、コマンド追加中心の仮説だったため再見積もりする。

- Phase 2A: contract hardening と release gate 整備を優先
- Phase 2B: 追加コマンドは Phase 2A 完了後に別途見積もる

---

# Phase 3: Claude Code Skills

## 3.1 スキル一覧

| スキル | 内容 |
|--------|------|
| `/pdfme-verify` | 変更検証（視覚品質基準付き） |
| `/pdfme-fix-rendering` | PDF描画デバッグ（**新規**） |
| `/pdfme-new-schema` | スキーマ雛形生成（自動検証付き） |
| `/pdfme-build` | スマートビルド |

## 3.2 `/pdfme-verify` 視覚品質基準

```
チェック基準:
a. テキストが読める（豆腐化なし）
b. テキストがバウンディングボックス内に収まっている
c. 画像が正しいアスペクト比
d. バーコード/QRコードが完全表示
e. テーブル罫線が揃っている
f. フィールド同士が意図せず重なっていない
```

## 3.3 `/pdfme-fix-rendering`（新規）

grid付き画像でフィールド位置を確認 → inspectで構造確認 → 修正 → 再生成で検証のワークフロー。

## 3.4 前提条件

Phase 3 は Phase 2A の exit criteria を満たした後に着手する。
Skills は不安定な CLI を吸収する層ではなく、**安定した CLI contract を束ねる層** として設計する。

markdown plugin / `md2pdf` は将来的に有力だが、Phase 2A 完了前に広げない。

## 3.5 工数

Phase 2A 完了後に再見積もりする。

---

# 全体スケジュール

| Phase | 状態 | 工数 |
|-------|------|------|
| 0: 互換性方針 | 完了 | 1日 |
| 1: Vite/Vitest/Oxlint | 完了 | 14-17日 |
| 2A: CLI contract hardening | 進行対象 | 再見積もり |
| 2B: CLI surface expansion | 2A完了後 | 再見積もり |
| 3: Skills | 2A完了後 | 再見積もり |

---

# 既知のリスクと対策

| リスク | 影響度 | 対策 |
|--------|--------|------|
| pdf-lib Vite移行でPDF描画差異 | 高 | 最後に移行、image snapshot前後比較 |
| pdfjs-dist v4 API変更 | 高 | converter importパス事前調査 |
| vitest-image-snapshot API差異 | 高 | `imageMatcher()` + `toMatchImage()` |
| vite-plugin-dts モノレポ問題 | 高 | 使用せず `tsc --emitDeclarationOnly` |
| official examples と playground asset の乖離 | 高 | shared manifest を単一の truth source にし、manifest 掲載 assets は CI で全件 generate |
| remote fetch 前提での再現性欠如 | 高 | versioned manifest + local cache + `--latest` opt-in |
| font/plugin 契約が曖昧なまま examples が増える | 高 | TTF/NotoSansJP/official plugins を短期 contract として固定し、unsupported は structured error |
| `--json` / invalid args 契約の揺れ | 高 | 全コマンドの JSON envelope と fail-fast validation を CI snapshot 化 |
| Oxlint型認識ルールの完全移行未了 | 中 | 当面は `tsc -b` を gate として維持 |
| set-version.js CJS問題 | 中 | ESM書き換えまたは.cjsリネーム |
| canvas ビルド失敗 | 中 | optionalDeps + 遅延import |
| playground Vite 4互換性 | 中 | file:経由のため影響限定的 |

---

# 後続タスク（スコープ外）

- CLAUDE.md改善（地図化 + CLI使い方セクション）
- docs/ナレッジベース
- docs/schema-defaults.json（静的参照ファイル）
- Vite+統合CLI移行（安定版リリース後）
- カスタムプラグインCLI対応（`--plugins`）
- `doctor` / `schema-info` / `template create` / `md2pdf` などの追加 surface は Phase 2A 完了後に再評価
