# pdfme/cli Strategic Report

## Executive Summary

`@pdfme/cli` は、方向性自体は正しい。`generate`, `validate`, `pdf2img`, `pdf2size`, `examples` という最小コマンド群で、pdfme を「コードから触れるライブラリ」から「エージェントが自律的に検証できるツールチェーン」に変える力を既に持っている。

ただし、現時点の CLI はまだ **Phase 3 の Skills / agent workflows を支える基盤** としては不十分だ。理由は機能不足よりも、**契約不足** にある。

- 公式 examples がそのまま動かない
- `--json` / exit code / error surface がコマンドごとに揺れている
- 不正オプション値を黙って受け入れる
- フォント / プラグイン / オフライン / remote asset の扱いが「実装依存」のまま露出している
- それらを防ぐ E2E の release gate がまだない

結論は明快で、**今 pdfme/cli に必要なのはコマンド追加ではなく、契約の固定化** である。  
この CLI は「便利なデモツール」ではなく、**pdfme v5 の machine interface** として設計し直す必要がある。

この観点では、`PLAN.md` にある新規サブコマンド群 (`inspect`, `list-schemas`, `schema-info`, `template create`, `template add-field`, `diff`) に先行して、以下を完了させるべきだ。

1. 公式 examples の可用性を保証する
2. 機械可読な CLI 契約を全コマンドで統一する
3. フォント / プラグイン / remote asset の runtime contract を明文化・実装する
4. 上記を CI で壊れないようにする

この 4 つが終わるまでは、Phase 2 は「コマンドが存在する」という意味では進んでいても、「公開 CLI として成立している」という意味では未完了と判断するのが妥当である。

## Evidence Base

このレポートは次の 3 層の情報を統合している。

### 1. 外部レポート

- Claude Code レポート  
  `/Users/kyoheifukuda/Develop/life/tmp/pdfme/CLI_FEEDBACK_REPORT.md`
- 別 Codex レポート  
  `/Users/kyoheifukuda/Develop/life/tmp/pdfme/20260323-151148-cli-feedback/REPORT.md`
- その機械可読サマリ  
  `/Users/kyoheifukuda/Develop/life/tmp/pdfme/20260323-151148-cli-feedback/SUMMARY.json`

### 2. このセッションでの実行ログ

- 18 ケースの実行結果  
  `/Users/kyoheifukuda/Develop/life/tmp/pdfme/report/REPORT.md`
- 機械可読サマリ  
  `/Users/kyoheifukuda/Develop/life/tmp/pdfme/report/runs.json`
- 抽出済み主要結果  
  `/Users/kyoheifukuda/Develop/life/tmp/pdfme/report/key-results.json`

### 3. 現行実装のコード確認

- `packages/cli/src/commands/generate.ts`
- `packages/cli/src/commands/pdf2img.ts`
- `packages/cli/src/commands/validate.ts`
- `packages/cli/src/fonts.ts`
- `packages/cli/src/example-templates.ts`
- `packages/cli/src/utils.ts`
- `playground/public/template-assets/index.json`
- `playground/public/template-assets/*/template.json`
- `packages/cli/__tests__/*.test.ts`

外部レポートの主張の多くは、ソースコード上でもそのまま根拠が確認できた。

## What Is Already Good

まず前提として、pdfme/cli は「ダメなもの」ではない。むしろ核はかなり良い。

### 1. コマンド設計は小さく、覚えやすい

CLI のコマンド面は過不足が少ない。`generate`, `validate`, `pdf2img`, `pdf2size`, `examples` の 5 本柱で、テンプレート検証から PDF 可視化まで一通り閉じている。

### 2. コア happy path は成立している

外部 Codex レポートでも、このセッションの 18 ケースでも、英字系の基本フローは通っている。

- `examples invoice --withInputs -> generate -> pdf2size -> pdf2img`
- unified JSON と `-t/-i` 分離入力の両対応
- `--image`, `--grid`, `--basePdf`, `--verbose`, `--json`
- A4 blank template と relative `basePdf`

これは「CLI の核になる workflow 自体」は正しいことを示している。

### 3. CLI が本当に欲しかった文脈を捉えている

`packages/cli/README.md` が書いているように、pdfme/cli の本質は人間向け UI の代替ではなく、**エージェントがテンプレートを編集し、生成し、画像化して検証するループ** を支えることにある。  
この問題設定自体は正しい。

### 4. `validate` の方向性は良い

`validate` は型候補提案、warning/error 分離、`--strict`、`--json` を備えており、CLI をただのラッパーではなく「テンプレート品質ゲート」にしようとしている点が良い。

## Core Diagnosis

pdfme/cli の現状を一言で言うと、**機能は先にあるが、契約が後ろから追いかけている状態** である。

問題は 4 つの層に分かれる。

### A. First-run trust の欠如

ユーザーが最初に触る `examples` が、そのまま生成できないケースを含んでいる。  
これは単なるバグではなく、**CLI のプロダクト人格を破壊する問題** である。

公式 examples は「サンプル」ではない。実質的には次の 3 役を兼ねている。

- onboarding surface
- regression fixture
- agent starter kit

ここが壊れている限り、他の機能が良くても「この CLI を信じてよいか」が揺らぐ。

### B. Machine contract の未完成

CLI は README 上も設計思想上も「AI エージェント特化」を掲げているが、実装はまだ agent contract になっていない。

- `--json` 失敗時の形式がコマンドごとに揺れる
- unknown option / invalid value を fail fast しない
- unified job の扱いが `generate` と `validate` で揃わない
- stdin がない
- default output が衝突しやすい

これは人間には不便、エージェントには危険である。

### C. Runtime contract の未整備

フォント、プラグイン、remote examples、sandbox/offline など、本来 CLI が吸収すべき runtime complexity が、そのまま利用者側に漏れている。

pdfme/cli が公開 CLI になるなら、利用者に必要なのは「内部事情の理解」ではなく、**再現可能で説明可能な失敗** である。

### D. Release discipline の不足

今起きている不整合の多くは、コード品質より **テスト境界の不足** で説明できる。

`packages/cli/__tests__` には良い unit test がある一方で、以下が欠けている。

- examples 全件 generate matrix
- invalid option values matrix
- `--json` failure contract matrix
- offline / network-denied behavior
- font/plugin dependency matrix

つまり、今の CLI は「壊れている」より「壊れ方を検出できていない」が近い。

## The Highest-Level Product Decision

pdfme/cli は今後、次のどちらかとして定義し直す必要がある。

### Option 1. Convenience CLI

ライブラリ周辺の便利ツールとして提供する。  
この場合、remote examples や optional runtime dependencies があっても許される。

### Option 2. Contract-grade CLI

CI、agent workflows、Skills、今後の自動検証基盤の中核として使う。  
この場合、examples, JSON, exit codes, offline, fonts, plugins まで含めて **壊れない約束** が必要になる。

pdfme v5 のロードマップと README の書き方を見る限り、pdfme/cli は明らかに Option 2 を目指している。  
ならば優先順位も Option 2 に合わせるべきで、**新機能追加より契約固定化が先** になる。

## Priority Recommendations

## P0. Official Examples Must Become a Supported Contract

これは最優先で、Phase 2 の完了条件に含めるべき。

### Why

- CLI の最初の導線が `examples`
- examples は README / onboarding / agent bootstrap の起点
- examples が壊れていると「CLI の能力」ではなく「CLI の信用」が壊れる

### Evidence

- Claude レポートでは 7/23 の templates が generate 失敗
- 外部 Codex レポートでも Japanese example と font/plugin 系が失敗
- `playground/public/template-assets/index.json` は `name` と `author` しか持たず、必要フォント・必要プラグイン・CLI 対応可否を一切表現していない
- `playground/public/template-assets/certificate-gold/template.json` は `PinyonScript-Regular` を要求する
- `playground/public/template-assets/invoice-ja-simple/template.json` は `NotoSerifJP` を大量に要求する
- `playground/public/template-assets/pedigree/template.json` は `signature` type を使う
- 一方 `packages/cli/src/commands/generate.ts` の plugin registry には `signature` が含まれていない
- `packages/cli/src/fonts.ts` の自動解決は `NotoSansJP` のみ

### What is needed

examples を「best effort」ではなく **release artifact** とみなすこと。

最低限必要なこと:

1. すべての公式 example を CLI CI で generate する
2. 生成できない example は index で明示的に unsupported とする
3. index に metadata を持たせる
4. examples の remote fetch だけに依存しない

### Recommended implementation direction

`playground/public/template-assets/index.json` に次のような metadata を追加する。

```json
{
  "name": "invoice-ja-simple",
  "author": "EedgeY",
  "cliSupported": false,
  "requiresFonts": ["NotoSerifJP"],
  "requiresPlugins": [],
  "offlineReady": true,
  "notes": "Requires serif Japanese font not bundled by CLI yet"
}
```

これにより `examples --list` でも `examples --json` でも、CLI 側が必要条件を事前提示できる。

そのうえで product decision を 3 択から選ぶべき。

1. CLI が必要 font/plugin を自動解決する
2. CLI 非対応 example を metadata で明示し、generate 時も先に弾く
3. CLI 対応可能な assets だけを official examples として再定義する

この 3 つを曖昧に混ぜるのが最悪で、現状はその状態に近い。

## P0. Establish a Single Machine Contract Across All Commands

CLI を agent substrate にするなら、**コマンドごとに「失敗の形」が違ってはいけない**。

### Evidence

- `validate --json` は成功時も失敗時も JSON を返せる
- `generate`, `pdf2img`, `pdf2size` は `--json` でも失敗時に plain text へ崩れる
- `generate` は unified job を読めるが、`validate` は読めない
- invalid option values が silent fallback するケースがある
- unknown flag の typo が直接原因として surface されない

### Code corroboration

- `packages/cli/src/commands/validate.ts:160-177`
  - `--json` 出力を success/failure 共通で構成できている
- `packages/cli/src/commands/generate.ts:167-180`
  - success 時だけ JSON、failure は plain text
- `packages/cli/src/utils.ts:39-55`
  - unified job 形式の解決は `generate` 側ユーティリティに閉じている
- `packages/cli/src/commands/validate.ts:160-162`
  - `validate` は単純に `readJsonFile(args.file)` を template 扱いしている
- `packages/cli/src/commands/generate.ts:107-120`
  - `scale`, `gridSize`, `imageFormat` を parse するが妥当性検証がない
- `packages/cli/src/commands/pdf2img.ts:25-35`
  - `scale`, `imageFormat`, `pages` に fail-fast validation がない
- `packages/cli/src/utils.ts:159-173`
  - `parsePageRange` は invalid token を quiet ignore する

### What is needed

全コマンドで同じ envelope を返すこと。

推奨 contract:

```json
{
  "ok": false,
  "command": "generate",
  "exitCode": 2,
  "error": {
    "code": "FONT_NOT_FOUND",
    "message": "NotoSerifJP is required by template.schemas",
    "details": {
      "fontName": "NotoSerifJP",
      "source": "template.schemas[0][3].fontName"
    }
  }
}
```

成功時も同じく:

```json
{
  "ok": true,
  "command": "pdf2img",
  "exitCode": 0,
  "data": {
    "pages": [...]
  }
}
```

これを `generate`, `validate`, `pdf2img`, `pdf2size`, `examples` 全部で揃える。

### Additional requirements

- unknown option は必ず non-zero
- invalid enum / number は必ず non-zero
- `validate` は unified job を受ける
- `-` / `--stdin` で stdin を受ける
- stderr は human mode 用、`--json` 時は原則 JSON だけを stdout に出す

## P0. Harden Font and Plugin Resolution

現状の font/plugin story は CLI の weakest link である。

### Evidence

- `packages/cli/src/fonts.ts:7-10` は `NotoSansJP` しか自動解決しない
- `packages/cli/src/fonts.ts:72-96` でも自動 fallback はその 1 系統のみ
- `packages/cli/src/commands/generate.ts:12-28` の plugin registry に `signature` がない
- 公式 example には `PinyonScript-Regular`, `NotoSerifJP`, `signature` が存在する
- 外部 Codex レポートでは `.ttc` 指定で `fontKitFont.layout is not a function` の internal crash

### Why this matters

pdfme のテンプレートは library world では「必要な font/plugin は呼び出し元が渡す」で成立する。  
しかし CLI world ではそれでは不十分で、CLI が **どこまで面倒を見るか** を決めなければならない。

### What is needed

pdfme/cli の font/plugin contract を、少なくとも次の 4 段階で定義するべき。

1. Built-in supported
2. Auto-download supported
3. User-supplied supported
4. Unsupported but explainable

例えば:

- `NotoSansJP`: auto-download supported
- `NotoSerifJP`: auto-download supported or unsupported but explicit
- `PinyonScript-Regular`: bundled or unsupported but explicit
- `signature`: bundled plugin or unsupported but explicit
- `.ttf`: supported
- `.otf`: supported/unsupported を明記
- `.ttc`: validation error にするか、正式対応する

重要なのは「なんとなく動く / たまたま落ちる」をやめること。

### Suggested implementation

- `font resolver` を registry 化する
- `example metadata` と `font resolver` を接続する
- `plugin resolver` を明示化する
- unsupported resource は `generate` 前に structured error で止める

`fontKitFont.layout is not a function` のような low-level crash は、公開 CLI では絶対に表面に出してはいけない。

## P0. Give `examples` a Real Offline Story

現状の `examples` は `packages/cli/src/example-templates.ts:5-32` にある通り、固定 remote URL から fetch するだけである。

これは README の「npx でもローカルでも同等の体験」や、agent workflow 前提と衝突している。

### Why

- sandbox / CI / airplane mode / corporate network で壊れる
- examples は本来「いつでも使える starter asset」であるべき
- agent workflows では network が最も不安定な依存になる

### Recommended direction

次のどちらかを明確に選ぶべき。

1. CLI package に examples を同梱する
2. 初回取得 + local cache + manifest versioning を実装する

中間案として「remote fetch only + env override」は開発には便利でも、公開 CLI のユーザー体験としては弱い。

### Minimum acceptable behavior

少なくとも、network 不可時に次は必要。

- 何にアクセスしたか
- local cache があるか
- 代替手段が何か
- `examples --list` がなぜ失敗したか

を structure と human text の両方で返す。

## P1. Normalize Command Semantics

### 1. `validate` と `generate` の入力契約を統一する

`generate` が unified job を受けるのに、`validate` が template-only 前提なのは自然ではない。  
ユーザーから見れば、`examples -w -> validate -> generate` が通るのが当然である。

`validate` は次の 3 形態を全部受けるべき。

- template-only JSON
- unified job JSON
- stdin

### 2. `pdf2img -o` の意味を fix する

今の help text は `Output directory or pattern` だが、実装は directory-only である。

コード上でも `packages/cli/src/commands/pdf2img.ts:51-78` は `args.output` を常に directory として扱い、`join(outputDir, \`${inputBase}-${page}.ext\`)` を組み立てている。

ここはどちらかに決めるべき。

1. 本当に directory-only にして help text を直す
2. file path / pattern syntax を正式サポートする

中途半端に「pattern と書いてあるが pattern ではない」が一番悪い。

### 3. Default output policy を safer にする

`output.pdf` に黙って書くのは便利だが、実運用では衝突しやすい。  
最低限、既存ファイル上書き時は warning or `--force` を検討する価値がある。

### 4. Built-in variables は明文化する

外部 Codex レポートでは invoice example の `{date}` が暗黙に解決される挙動が観測されている。  
これは便利な機能かもしれないが、agent から見ると「どこから来た値かわからない隠し状態」になる。

この種の implicit variable は必ずドキュメント化するべき。

## P1. Clean Up Error UX

### 1. Error taxonomy を持つ

今の CLI は human-readable text はかなり丁寧だが、error code taxonomy がない。  
これでは `--json` で構造化しても downstream tooling が安定しない。

少なくとも以下は必要。

- `INVALID_ARGUMENT`
- `FILE_NOT_FOUND`
- `JSON_PARSE_ERROR`
- `PDF_PARSE_ERROR`
- `FONT_NOT_FOUND`
- `PLUGIN_NOT_FOUND`
- `NETWORK_ERROR`
- `UNSUPPORTED_RESOURCE`

### 2. Stack trace leak を止める

bad PDF input で pdf.js の stack trace や local path が出るのは公開 CLI としてはノイズが大きい。  
debug mode に寄せるべき情報と、通常 mode で見せるべき情報は分けるべき。

### 3. Message tone を揃える

`File not found`, `PDF file not found`, raw runtime error, validation error の出し方が揺れている。  
人間には小さな違いでも、CLI はこういう細部で「信頼できるか」が決まる。

## P1. Build a Real CLI Test Matrix

現状の test は悪くないが、release gate としては不足している。

### What current tests cover

`packages/cli/__tests__` がカバーしているのは主に:

- CJK detection
- examples fetch mock
- simple generate
- simple validate
- utility functions

### What is missing

1. examples compatibility matrix
2. font/plugin dependency matrix
3. invalid option matrix
4. `--json` success/failure matrix
5. offline / sandbox matrix
6. not-a-pdf / malformed input sanitization

### Recommended CI gates

最低でも以下を CI に入れるべき。

- official examples 全件 `examples -> generate`
- supported / unsupported metadata の整合性検査
- `--json` failure snapshot
- invalid argument snapshot
- no-network mode での `examples` expected behavior
- image-side effects の basic snapshot

ここを通さずに新機能だけ増やすと、また同種の regressions が再発する。

## P2. Improve the Product Surface After Contract Hardening

P0/P1 を終えてからやる価値が高いものは多い。

### 1. `examples --list --json`

metadata を持たせるなら、CLI 側でも JSON で返せるべき。

### 2. `schema-info`, `list-schemas`, `template create`

`PLAN.md` にある構想自体は非常に良い。  
ただし今着手すると、基盤が不安定なまま surface area だけ広がる。

### 3. `doctor` / `inspect` 系

CLI の次の一歩としては、追加生成機能より **環境診断** の方が先に効く可能性が高い。

例:

- `pdfme doctor`
- `pdfme doctor fonts`
- `pdfme inspect template.json`

これは font/plugin/runtime 問題を自己診断できるため、support cost を大きく下げる。

## Concrete Code-Level Corroboration

| 論点 | 実装根拠 | コメント |
|---|---|---|
| examples が remote-only | `packages/cli/src/example-templates.ts:5-32` | local bundle / cache / metadata がない |
| `validate` が unified job 非対応 | `packages/cli/src/commands/validate.ts:160-162` | `generate` は `packages/cli/src/utils.ts:39-55` で unified 解決済み |
| `signature` plugin 不足 | `packages/cli/src/commands/generate.ts:12-28` | `playground/public/template-assets/pedigree/template.json:107-116` は `signature` を要求 |
| font 自動解決が NotoSansJP のみ | `packages/cli/src/fonts.ts:7-10`, `72-96` | `NotoSerifJP` / `PinyonScript-Regular` に届かない |
| examples metadata が薄い | `playground/public/template-assets/index.json:1-94` | `name`, `author` しかない |
| invalid numeric / enum を validate していない | `packages/cli/src/commands/generate.ts:107-120`, `packages/cli/src/commands/pdf2img.ts:25-35`, `packages/cli/src/utils.ts:159-173` | `NaN` / invalid page syntax / unsupported image format を early reject しない |
| `pdf2img -o` が実質 directory-only | `packages/cli/src/commands/pdf2img.ts:15`, `51-55`, `77-78` | help text と挙動がズレている |
| `--json` failure が統一されていない | `packages/cli/src/commands/generate.ts:167-180`, `packages/cli/src/commands/validate.ts:164-177` | `validate` だけ比較的 contract が良い |
| stack trace sanitize 不足 | `pdf2img` / `pdf2size` は変換失敗の wrapper が薄い | low-level runtime error がそのまま出やすい |

## Roadmap Implications

`PLAN.md` では Phase 2 が CLI、Phase 3 が Skills になっている。  
この順序は正しいが、**Phase 2 の done definition を見直す必要がある**。

現状の done definition は「コマンドがある」に寄っている。  
しかし実際に必要なのは「Skills が載っても壊れない CLI」である。

したがって、Phase 2 の完了条件は少なくとも次に更新するべきだ。

### Revised Phase 2 exit criteria

1. official examples の CLI 対応可否が metadata で定義されている
2. CLI 対応 examples は CI で generate green
3. 全コマンドで `--json` failure contract が固定されている
4. invalid option values は全て fail fast
5. offline/sandbox での examples behavior が deterministic
6. font/plugin unsupported cases が internal crash ではなく structured error になる
7. user-facing version が `0.0.0` ではない

これを満たしてから Phase 3 の Skills に進むべきである。  
逆に言えば、今 Skills を先に作ると、Skills 側で CLI の不安定さを吸収することになり、設計負債が増える。

## Recommended Implementation Sequence

## Track 1. Contract Hardening

期間の目安: 1 週間

- `--json` response envelope を全コマンドに導入
- unified job を `validate` でも受理
- unknown option / invalid value の strict validation
- error code taxonomy 導入
- stack trace sanitize

### Success criteria

- `generate`, `validate`, `pdf2img`, `pdf2size`, `examples` の failure がすべて JSON で parse 可能
- `--scale nope`, `--gridSize foo`, `--imageFormat gif`, `--pages nope` が全て non-zero

## Track 2. Example and Runtime Hardening

期間の目安: 1-2 週間

- example manifest metadata 拡張
- examples の offline story を決めて実装
- font registry / auto-resolution policy 確定
- `signature` plugin 対応方針確定
- `.ttf/.otf/.ttc` support policy 明文化

### Success criteria

- official examples が「supported / unsupported」どちらかに必ず分類される
- supported examples は CLI で green
- unsupported examples は generate 前に明示エラー

## Track 3. Release Discipline

期間の目安: 1 週間

- examples matrix test
- invalid option matrix
- JSON failure snapshot
- offline test lane
- doc update

### Success criteria

- 今回外部レポートで見つかった regressions が CI で再現可能
- release 前に human が思い出す必要がない

## Track 4. Surface Expansion

期間の目安: その後

- `schema-info`
- `list-schemas`
- `template create`
- `template add-field`
- `inspect`
- `doctor`

この順序にすることで、CLI の「土台」を壊さずに拡張できる。

## What Should Be Deferred

少なくとも次が終わるまで、派手な新機能追加は後ろ倒しにするべきだ。

- examples contract
- JSON contract
- option validation
- runtime/font/plugin contract
- E2E matrix

理由は単純で、今の pdfme/cli の最大の不足は「できないこと」ではなく「どこまで信じてよいかがまだ曖昧なこと」だからである。

## Final Recommendation

pdfme/cli の次の一手は、**機能拡張ではなく信頼性の制度化** である。

この CLI はすでに「便利」には近い。  
今必要なのは「便利な CLI」から「壊れない interface」へ移ることだ。

戦略的には次の順序を強く勧める。

1. examples を official contract に格上げする
2. machine-readable contract を全コマンドで固定する
3. font/plugin/offline を公開 runtime contract にする
4. CI でそれを壊せないようにする
5. その後に Phase 3 Skills と新規サブコマンドへ進む

pdfme v5 の方向性を本当に左右するのは、新しいコマンドの数ではない。  
**CLI を中心に、人間・CI・エージェントの三者が同じ契約を共有できるかどうか** である。

その意味で、pdfme/cli が今もっとも必要としているものは、`more features` ではなく `stronger guarantees` である。
