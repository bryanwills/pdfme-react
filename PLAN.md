# pdfme AI駆動開発基盤 — PLAN

Last updated: 2026-03-26 JST

Latest committed checkpoint:

- `7adcc8b3` `fix(cli): align remote font policy contracts`

## Context

pdfme 開発で解消したいボトルネックは次の 2 点。

1. build / test / lint が重く、変更反映が遅い
2. agent が PDF 出力を自律検証しづらい

## Snapshot

| 項目 | 状態 | 要約 |
|------|------|------|
| Phase 0 | 完了 | 互換性方針と migration 方針を確定 |
| Phase 1 | 完了 | build / test / lint / typecheck 基盤の移行完了 |
| Phase 2A | 完了 | `@pdfme/cli` の contract hardening を完了 |
| Phase 2B | 進行中 | `doctor` と remote font policy の first pass を固定し、declarative Google Fonts surface / remote cache workflow の要否判断を残す |
| Rich Text / Markdown Track | 未着手 | CLI hardening とは別トラックで検討 |

## Completed

### Phase 0

- breaking changes 方針を確定
- migration guide / README / 関連 docs を更新
- playground / Node playground の ESM 移行ブロッカーを解消

確定済みの breaking changes:

| 項目 | 方針 |
|------|------|
| モジュール形式 | ESM-only |
| Node | 20+ |
| React | UI package は 18+ |
| import | `dist/*` 直参照は廃止し package exports に統一 |

### Phase 1

- root の build / test / lint / fmt / typecheck の front door を整理
- 全 package の Jest -> Vitest 移行を完了
- 全 package の build を Vite ベースへ移行
- package exports / internal path / CI を ESM-only 方針に合わせて整理
- playground を package root exports 前提に寄せた
- `vp` を task runner / lint / fmt の front door として採用

現在の基盤:

| 項目 | 現在の方針 |
|------|-----------|
| build | package-local の Vite library mode |
| test | Vitest |
| lint / format | `vp lint` / `vp fmt` |
| typecheck | `tsc -b` |
| modules | ESM-only を前提に整理 |

補足:

- `vp lint` の type-aware lint は現行 tsconfig と相性課題があるため、型検証 gate は引き続き `tsc -b`

## Phase 2: `@pdfme/cli` を contract-grade machine interface にする

Status: 完了

### 2.1 Positioning

`@pdfme/cli` は便利ツールではなく、pdfme v5 の machine interface として扱う。
Phase 2 の主目的はコマンド数を増やすことではなく、agent / CI / human が同じ契約で扱える CLI を作ること。

現時点での最重要課題は「できることを増やすこと」ではなく、
「どこまで信じてよいかを明確にすること」。

### 2.2 Current Scope

Phase 2A で固定する対象:

- `pdfme generate`
- `pdfme validate`
- `pdfme pdf2img`
- `pdfme pdf2size`
- `pdfme examples`

### 2.3 Done So Far

- `generate` / `validate` / `pdf2img` / `pdf2size` の共通 contract hardening
- `--json` success / failure envelope の統一
- invalid args の fail-fast 化
- `validate` の unified job / stdin 対応
- `pdf2img -o` の directory-only 明確化
- implicit `output.pdf` の safety guard
- `examples` の official manifest / template fetch を structured contract で扱うよう整理
- `signature` の公式 plugin 化
- official example font を unified job `options.font` に埋め込む対応
- playground asset manifest の metadata-aware 化
- manifest 掲載 templates の renderability を確認する CLI integration test 追加
- manifest 掲載 official examples を `examples` / `generate` の real CLI path で全件 green にする E2E 追加
- `pdf2size` の CLI test 追加
- unknown flag / malformed JSON / malformed stdin / invalid enum / overwrite などの cross-command contract test 追加
- version 表示の `0.0.0` 固定解消
- schema plugin 解決を export 追従の自動収集へ整理
- unsupported custom font / unknown schema type / auto-font unavailable を structured error に固定
- local input 前提の `generate` / `validate` / `pdf2img` / `pdf2size` offline contract test を追加

### 2.4 Remaining Work

Phase 2A の blocking work は解消済み。
次の残タスクは font policy revisit を product spec として詰め、font source matrix を `doctor` / `generate` 契約として固定すること。

### 2.5 Exit Criteria

1. official examples の CLI 対応範囲が manifest / metadata で定義されている
2. CLI 対応 examples は CI で real CLI path の generate green
3. `examples` は current official manifest を取得して deterministic に利用できる
4. `--json` 指定時、全コマンドの成功失敗が JSON で parse 可能
5. invalid args / invalid enum / invalid number / invalid page range が fail-fast + non-zero
6. `validate` が template-only / unified job / stdin / `--strict` を一貫して扱える
7. font / plugin / malformed input が internal crash ではなく structured error になる
8. `generate` / `validate` / `pdf2img` / `pdf2size` が examples 取得とは独立にオフラインで成立する
9. user-facing version 表示が workspace 内でも正しい

### 2.6 Fixed Policies

Examples:

- `examples` と `playground` は同じ資産を共有する
- examples は onboarding 用サンプルであると同時に、将来の AI / RAG 資産として扱う
- manifest 掲載 assets は contract-first で整備する
- manifest に掲載する official examples はすべて CLI-supported とする
- CLI で安定サポートできない asset は manifest に載せない
- `examples` は convenience command として扱い、current official manifest を参照する

Plugin:

- CLI は公式 plugin をすべて使える状態を目指す
- CLI の標準機能として third-party plugin を汎用サポートする方針は取らない
- third-party plugin 対応が必要なら、標準 product surface ではなく個別実装の扱いとする
- `signature` は公式 plugin として扱う

Font:

- user-facing font contract は source ベースで扱う
- `--font` は local `.ttf` path を強保証対象にする
- 同名競合時は `--font` を `options.font` より優先する
- unified job `options.font.<name>.data` は local `.ttf` path / `http(s)` `.ttf` URL / `.ttf` data URI を強保証対象にする
- CJK fallback は implicit `NotoSansJP` cache / download で吸収する
- `otf` / `ttc` / missing local path / unsupported protocol は fail-fast + structured error に寄せる
- unsupported font / plugin / runtime 条件は generate 実行後の crash ではなく structured error にする

Font policy revisit memo:

- 現行の source contract は短期的には local/remote/data-uri の `.ttf` と `NotoSansJP` を中心に置く
- 次の検討候補は「Google Fonts にある font family / weight / style を公式サポート対象にする」方針
- これで多くの user needs を満たせる可能性が高く、単一フォント名の強保証より自然な product contract になりうる
- その場合でも runtime contract は別途必要で、local `.ttf` / cached Google Fonts / unresolved remote font をどう切るかを明示する
- `otf` / `ttc` を引き続き unsupported にするか、Google Fonts support とあわせて再評価する
- offline 条件、cache 方針、`validate --json` / `generate --json` で返す structured error shape を合わせて設計する
- source contract の次段階は Google Fonts policy と runtime matrix の固定

Font policy decision (2026-03-26):

- current CLI の official remote font source は raw font asset URL ベースで扱う
- `fonts.gstatic.com` の direct `.ttf` asset URL は official remote source として扱う
- `fonts.googleapis.com/css*` の stylesheet API は font binary ではないため unsupported とし、fail-fast + structured error に寄せる
- Google Fonts の family / weight / style を declarative に解決する専用 surface は、今回の slice では導入しない
- 強保証対象は local `.ttf` / public direct `.ttf` URL / `.ttf` data URI / inline bytes とし、拡張子や media type が曖昧な source は warning 付き best-effort に留める
- CLI が cache する remote font は implicit `NotoSansJP` のみとし、explicit remote font は generate 実行時の source 解決に任せる

Recommended next decision:

- 既定方針としては、declarative Google Fonts surface は Phase 2B に入れず、raw asset URL contract を維持する
- 既定方針としては、explicit remote font cache も product surface に追加せず、`needsNetwork` diagnosis + runtime failure contract の明確化に留める
- もし上記 2 点のどちらかを product 化するなら、実装前に CLI syntax / cache location / offline semantics / `--json` failure shape を spec に起こす

JSON / exit code:

- `--json` 指定時は stdout を JSON のみに固定
- human-readable な補足は stderr に寄せる
- failure path の shape を command ごとに変えない

I/O:

- `pdf2img -o` は当面 directory-only
- 暗黙の `output.pdf` は安全策付きで扱う

Offline:

- core commands は local input があれば offline で成立させる
- `examples` は network 前提の convenience command として扱う

Validation / inspection:

- `inspect` は独立コマンドとしては作らない
- template/job の構造把握は `validate` の出力拡張で吸収する
- 将来的に `validate --json` で pages, fields, schema types, required fonts/plugins, basePdf summary を返せるようにする

### 2.7 Not In Scope For Phase 2A

次は roadmap から外す、または Phase 2A の対象外とする。

- `list-schemas`
- `schema-info`
- `template create`
- `template add-field`
- markdown plugin の CLI 露出
- `md2pdf`

理由:

- `list-schemas` / `schema-info` は、CLI を公式 plugin 専用とする方針なら優先度が低い
- `template create` / `template add-field` は、examples と直接 JSON 編集で代替できる
- markdown plugin / `md2pdf` は、CLI hardening ではなく別の product track

## Phase 2B: Operational UX

Status: 進行中

Phase 2A 完了後の first slice として `pdfme doctor` の contract を追加した。
現時点では env 診断、`doctor <job-or-template>`、`doctor fonts <job-or-template>`、generate 相当の output runtime/path 診断、font source contract の first pass、runtime permission matrix、font edge-case matrix を実装し、Google Fonts / remote font policy も「direct asset URL を official source、stylesheet API は unsupported」として固定した。残論点は declarative Google Fonts surface と explicit remote cache workflow を本当に product 化するかどうか。

### `doctor` の具体像

目的:

- generate 実行前に、その job / template がこの環境で成功可能かを自己診断できるようにする
- font / plugin / runtime / path 問題を user と agent の両方が早い段階で特定できるようにする

最小スコープ:

- [x] `pdfme doctor`
  - Node version / CLI version / OS
  - `cwd` / temp dir / font cache の状態
  - 書き込み可否と基本的な runtime 前提の確認
- [x] `pdfme doctor <job-or-template>`
  - JSON parse 可否
  - `validate` 相当の検査
  - basePdf の path 解決可否
  - 使用 schema types
  - 必要 official plugins
  - 必要 fonts と unsupported conditions
  - generate output path / implicit overwrite / image output path の runtime 診断
- [x] `pdfme doctor fonts <job-or-template>`
  - custom font path の存在確認
  - `.ttf` 以外の unsupported 検出
  - auto-font で吸収可能かの診断
- [x] `--json`
  - 診断結果を構造化して返す
  - blocking issue があれば non-zero

期待する効果:

- support cost の削減
- generate 失敗前の早期自己診断
- agent からの安全な事前チェック

## Separate Future Track: Rich Text / Markdown Authoring

Status: 未着手

これは Phase 2A の一部ではなく、別トラックとして扱う。

### Goal

AI に「雇用契約書を作って」などと依頼したときに、AI が文面を生成し、
それをそのまま PDF 化できるルートを作る。

### Why This Is Separate

- これは CLI hardening ではなく、新しい document authoring surface の追加
- rich text / markdown schema 自体の設計が先に必要
- 実装は軽く終わる種類ではなく、schema / rendering / editor / DX をまとめて考える必要がある

### Assumptions

- rich text schema や markdown-capable plugin の検討を先に進める
- `md2pdf` は markdown plugin / rich text foundation ができた後に実現可能になる
- issue #564 など既存の rich text 構想を踏まえ、spec から詰める

### Current Decision

- Phase 2A の backlog には入れない
- `md2pdf` を単独先行で作らない
- まずは rich text / markdown plugin の product spec を固める

## Next Order

1. declarative Google Fonts surface を Phase 2B の対象外として据え置くか、product 要件があるかを判断する
2. explicit remote font cache / offline workflow を product surface に追加しない前提でよいか判断する
3. 上記を追加しない前提なら、explicit remote font の network-failure contract を `doctor` / `generate` test に足して固定する
4. 上記の判断が固まったら、Phase 2B closeout 条件を更新する

## Implementation Task List

### Track A: examples manifest CI gate

- [x] `playground/public/template-assets/manifest.json` と `index.json` の整合性を検証する test を追加する
- [x] manifest 各 entry の `path` と `thumbnailPath` の実在確認を test に追加する
- [x] manifest 各 entry の `pageCount` / `fieldCount` / `schemaTypes` / `fontNames` / `hasCJK` / `basePdfKind` が実 template と一致することを検証する
- [x] 上記 checks を新 workflow ではなく既存の `npm run test` に載せる
- [x] examples fixture は localhost server ではなく preload した fetch shim を使う現行方針を維持する

### Track B: real CLI path green の CI 固定

- [x] manifest 掲載 official examples について real CLI path の `examples --withInputs` -> `generate` が通る E2E を CI で維持する
- [x] real CLI path の examples E2E が child process 実行であることを維持する
- [x] examples と playground が shared assets 前提で壊れないよう、manifest 更新時に CLI 側 test も同時に落ちる状態を維持する
- [x] manifest に載る official examples はすべて CLI-supported である contract を metadata / test で固定する

### Track C: examples metadata の contract 明示化

- [x] official examples の CLI 対応範囲を manifest / metadata で表現する項目を定義する
- [x] metadata から official examples contract を判定できるようにする
- [x] examples metadata の shape を test で固定し、意図しない変更を検出できるようにする
- [x] `examples` が current official manifest を deterministic に利用できる前提を崩さないことを確認する

### Track D: `validate` 出力拡張

- [x] `inspect` を新設せず、`validate --json` で inspection needs を吸収する方針を実装に落とす
- [x] `validate --json` の success payload に pages, fields, schema types, required fonts/plugins, basePdf summary を追加する
- [x] template-only / unified job / stdin / `--strict` の各入力経路で同じ contract を返すようにする
- [x] unsupported font / plugin / malformed input を internal crash ではなく structured error で返すことを test で固定する
- [x] success / failure envelope を他 command と同様に parse 可能な JSON contract として維持する

### Track E: Phase 2A 完了判定

- [x] Exit Criteria 1: official examples の CLI 対応範囲が manifest / metadata で定義されていることを確認する
- [x] Exit Criteria 2: CLI 対応 examples が CI で real CLI path generate green であることを確認する
- [x] Exit Criteria 3: `examples` が current official manifest を deterministic に取得・利用できることを確認する
- [x] Exit Criteria 4: `--json` 指定時に全対象 command の成功失敗が JSON で parse 可能であることを確認する
- [x] Exit Criteria 5: invalid args / invalid enum / invalid number / invalid page range が fail-fast + non-zero であることを確認する
- [x] Exit Criteria 6: `validate` が template-only / unified job / stdin / `--strict` を一貫処理することを確認する
- [x] Exit Criteria 7: font / plugin / malformed input が structured error になることを確認する
- [x] Exit Criteria 8: `generate` / `validate` / `pdf2img` / `pdf2size` が examples 取得と独立に offline で成立することを確認する
- [x] Exit Criteria 9: workspace 内でも user-facing version 表示が正しいことを確認する
- [x] Phase 2A 完了までは `doctor` に着手しない

### Memo: examples CI gate の具体化

目的:

- playground asset 更新で CLI が静かに壊れるのを PR 時点で止める
- `examples` を cache/versioning 付き配布機構ではなく、current official manifest を読む convenience command として安定化する
- official examples を「参考 JSON」ではなく、CLI が実際に依存してよい入力資産として固定する

最小チェック項目:

- `playground/public/template-assets/manifest.json` と `index.json` の内容整合性を確認する
- manifest の各 entry について `path` / `thumbnailPath` が実在することを確認する
- manifest の各 entry について `pageCount` / `fieldCount` / `schemaTypes` / `fontNames` / `hasCJK` / `basePdfKind` が実 template と一致することを確認する
- manifest 掲載 official examples が real CLI path の `examples --withInputs` -> `generate` で green であることを確認する

実装メモ:

- 新しい複雑な workflow は増やさず、既存 PR CI の `npm run test` に乗る test として実装する
- `examples` は current manifest を読むだけなので、versioned manifest や local cache を CI の必須契約にはしない
- fixture は localhost server ではなく preload した fetch shim を使う現行方針を維持する

## Verification Summary

確認済みの要点:

- root の `build` / `test` / `lint` / `typecheck` が通る状態まで整理済み
- 全 package の Vitest / Vite 移行後も package exports 経由で解決できる
- playground は package root export 前提で動作する構成に整理済み
- official examples / manifest / plugin / font 周りの CLI integration test を追加済み
- manifest 掲載 official examples は real CLI path の `examples` / `generate` 経由で green を確認済み
- `--json` failure contract は cross-command test で固定を進めている
- `generate` の unknown schema type は fail-fast + `EVALIDATE` で返す
- CJK auto-font unavailable / `--noAutoFont` without explicit font は `EFONT` で返す
- `doctor` は env / input / fonts / runtime 診断を `--json` で返せる
- font source contract は local path / `http(s)` URL / data URI の `.ttf` を中心に整理済み
- Google Fonts policy は「direct `fonts.gstatic.com` asset URL は supported、`fonts.googleapis.com/css*` stylesheet API は unsupported」で固定済み
- output dir / permission 系の runtime matrix は `doctor` test で固定済み
- font source edge-case matrix は `doctor` / `generate` test で固定済み
- `packages/cli` test は 107 件 green、lint も green

## Known Risks

| リスク | 対策 |
|--------|------|
| official examples と playground assets の乖離 | shared manifest と renderability test を維持する |
| examples manifest 更新漏れ | manifest 整合性 test と real CLI path test を CI で維持する |
| font / plugin 契約の揺れ | 短期 contract を固定し unsupported は structured error に寄せる |
| `--json` / invalid args の挙動差 | cross-command E2E matrix で固定する |
| `vp lint` の type-aware lint 完全移行未了 | 型検証 gate は当面 `tsc -b` を維持する |
| official plugin と docs / playground / CLI の実装差分 | shared implementation と integration test を維持する |

## Notes For Next Turn

- この `PLAN.md` を先に読む
- Phase 2 の主目的は command expansion ではなく contract hardening
- official examples は shared assets 前提で CLI green を維持する
- `real CLI path` の examples E2E は child process で `examples` / `generate` を実行して確認する
- examples fixture は localhost server ではなく preload した fetch shim で差し替える
- `inspect` は `validate` の出力拡張へ吸収する
- CLI は公式 plugin 専用の方針で進める
- Next priority は declarative Google Fonts surface と remote font cache workflow を本当に product 化するかの判断
- 強い追加要件がなければ、次の実装 slice は feature 追加ではなく explicit remote font の network-failure contract test 固定
- もし新 surface を追加するなら、先に syntax / offline / cache / JSON error shape を `PLAN.md` に書き起こしてから着手する
- `PLAN.md` の checkpoint は次回 commit / push 後に更新する
- Phase 2A は完了済み。次は `doctor` を operational UX として再評価する
- rich text / markdown / `md2pdf` は別トラックとして spec から検討する
