# pdfme AI駆動開発基盤 — PLAN

Last updated: 2026-03-28 JST

Latest committed checkpoint:

- `8ffc8c9d` `feat(cli): extend verbose parity across commands`

## Purpose

この文書は roadmap / product decision / 未完了事項だけを残す。

次のものはここに再掲しない:

- 現行実装を読めば分かること
- `packages/cli/README.md` を読めば分かること
- 完了済み checklist や implementation log

## Current Focus

pdfme 側で今優先するのは新機能追加ではなく、`@pdfme/cli` の post-closeout polish。

主眼:

1. agent / CI / human が同じ surface を扱いやすいこと
2. command 間の UX 差を減らすこと
3. docs / onboarding を実利用に寄せること

## Current State

| 項目 | 状態 | メモ |
|------|------|------|
| Build / Test / Typecheck 基盤 | 安定 | v5 開発の前提として維持 |
| CLI hardening | 完了 | contract-grade machine interface 化は完了 |
| Operational UX closeout | 完了 | `doctor` を含む closeout は完了 |
| Post-closeout polish | 進行中 | parity / discoverability / docs を詰める段階 |
| Rich Text / Markdown Track | 未着手 | CLI polish と分けて扱う |

## Stable Product Decisions

- `@pdfme/cli` は command expansion より machine interface quality を優先する
- CLI は公式 plugin 前提で進める
- `examples` は convenience command として扱い、core workflow と分ける
- 新しい surface を入れるなら、実装前に spec を先に書く
- 未リリース段階の parity work では、canonical surface を固めるための breaking rename / removal を許容する
- Rich Text / Markdown Authoring は CLI hardening とは別トラックとして扱う

## Active Work

### 1. Cross-Command UX Parity

次の重点は verbose 以外の parity。

- parity は additive alias より canonical rename を優先する
- count semantics は `pageCount` / `templatePageCount` / `estimatedPageCount` を分ける
- path semantics は `outputPath` / `outputPaths` / `outputDir` / `imagePaths` に寄せる
- success payload の breaking normalize と verbose label を first pass の対象にする
- command ごとの差を「意図した違い」に絞る

### 2. Input Discoverability

`multiVariableText` の first pass の次を判断する。

- `inputHints` を他の特殊入力型まで広げるか決める
- 広げるなら、型ごとの input contract を先に整理する
- generic すぎる hint で誤解を増やさない

### 3. Docs / Onboarding Polish

- `examples --withInputs` / `doctor` / `generate --image --grid` の流れを前面に出す
- `basePdf` overlay workflow の実務価値をもっと見せる
- agent 向け onboarding を短く強くする

## Open Questions

- `doctor.validation.*` の nested legacy count をどこまで残すか
- `inputHints` を広げる対象はどこまでにするか
- onboarding の主役を `examples` 起点にするか、`basePdf` overlay 起点にするか

## Explicit Non-Goals For The Next Slice

- 大きな新 CLI command の追加
- declarative font surface の再設計
- explicit remote font cache の product 化
- `md2pdf` の単独先行
- Rich Text / Markdown track を CLI polish と混ぜること

## Separate Future Track: Rich Text / Markdown Authoring

強いユースケースは、本文 PDF を Markdown / Rich Text から先に作り、その出力を `basePdf` として再利用し、署名欄や追記事項だけを後段 overlay する flow。

この track では次を前提にする:

- `md2pdf` を先に単独実装しない
- まず product spec を作る
- その後に CLI surface の必要性を判断する

## Risks

| リスク | 対応方針 |
|--------|----------|
| examples と playground assets の乖離 | shared assets 前提を維持する |
| command ごとの payload / output 差の拡大 | parity を継続監視する |
| spec なしで新 surface が増える | 先に `PLAN.md` に判断を書く |

## Notes For Next Turn

- まずこの `PLAN.md` を読む
- 次の slice は feature 追加ではなく parity / discoverability / docs polish を優先する
- current parity slice では pre-release 前提で canonical field 名へ揃える
