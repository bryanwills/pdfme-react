# pdfme AI駆動開発基盤 — PLAN

Last updated: 2026-03-28 JST

Latest committed checkpoint:

- `00f8b40e` `feat(cli): normalize doctor counts and validate canonical dates`

## Purpose

この文書は roadmap / product decision / 未完了事項だけを残す。

次のものはここに再掲しない:

- 現行実装を読めば分かること
- `packages/cli/README.md` を読めば分かること
- 完了済み checklist や implementation log

## Current Focus

`@pdfme/cli` の post-closeout polish は first pass を閉じた。次は use-case discovery と template strategy を spec として固める。

## Current State

| 項目 | 状態 | メモ |
|------|------|------|
| Build / Test / Typecheck 基盤 | 安定 | v5 開発の前提として維持 |
| CLI hardening | 完了 | contract-grade machine interface 化は完了 |
| Operational UX closeout | 完了 | `doctor` を含む closeout は完了 |
| Post-closeout polish | 完了 | cross-command parity と strictness boundary の first pass を含めて close |
| Use Case / Template Strategy | 進行中 | 画像→テンプレート化、template corpus、将来検索導線を整理する段階 |
| Rich Text / Markdown Track | 未着手 | CLI polish と分けて扱う |

## Stable Product Decisions

- `@pdfme/cli` は command expansion より machine interface quality を優先する
- CLI は公式 plugin 前提で進める
- `examples` は convenience command として扱い、core workflow と分ける
- 新しい surface を入れるなら、実装前に spec を先に書く
- 未リリース段階の parity work では、canonical surface を固めるための breaking rename / removal を許容する
- scalar count は top-level canonical field 名を優先し、legacy duplicate count は増やさない
- date 系 input は display format hint を出しつつ、renderer parse で normalize されない canonical stored content だけを受ける
- asset-like input と barcode 系は current slice では hint-first を維持し、validation 拡張は必要が出るまで保留する
- 将来展開が大きいテーマは、実装前に idea / use-case discovery フェーズを 1 度挟む
- Rich Text / Markdown Authoring は CLI hardening とは別トラックとして扱う

## Active Work

### 1. Idea / Use-Case Discovery

実装を急がず、将来の展開を考えるための探索フェーズを切る。

- 画像からテンプレート作成するユースケースを明文化する
- `pdf2img` 起点の現行 workflow で十分か、より direct な product surface が必要かを判断する
- template 資産を今後どう増やすかを、業種 / 帳票種別 / locale / schema coverage の観点で整理する
- examples / playground / website docs / template-assets の役割分担を決める
- 将来の template search / RAG のために、まず metadata-first の設計を考える
- embeddings や retrieval 実装は後段に置き、先に corpus と manifest の shape を固める
- このフェーズの成果物は `use-case memo` / `template manifest draft` / `phase split` の 3 点に絞る
- implementation に進む条件は、primary use case・metadata axis・最初の distribution surface が言語化できていること

## Open Questions

- 画像→テンプレート化を docs workflow として押すか、専用 surface の候補として育てるか
- template corpus の metadata を何で切るか (`industry`, `locale`, `documentType`, `schemaTypes`, `basePdfKind`, etc.)
- 将来の search / RAG は local manifest search から始めるか、embedding retrieval まで視野に入れるか

## Explicit Non-Goals For The Next Slice

- 大きな新 CLI command の追加
- declarative font surface の再設計
- explicit remote font cache の product 化
- template marketplace / RAG system の即実装
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
- next slice は use-case discovery を implementation ではなく spec / idea 出しとして進める
- template strategy は manifest / metadata / distribution surface の順で詰める
