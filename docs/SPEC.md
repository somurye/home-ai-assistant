# Google統合型 家計・在庫・献立アシスタント

## システム仕様書 v1.3

**作成日:** 2026-09-24
**更新日:** 2026-09-28
**対象:** 個人・家族向けGoogle統合型 家計・在庫・献立アシスタント
**開発方式:** Git管理の仮想プロジェクト + Google Apps Script
**AI:** Gemini API
**データ:** Google Spreadsheet
**ファイル保管:** Google Drive

**v1.2での変更点:**
* TASK-000(開発基盤・運用基盤構築)完了を反映
* TASK-001以降の詳細な作業計画を `docs/TASK_PLAN.md` に分離・明記
* 第38章(MVPロードマップ)を `docs/TASK_PLAN.md` への参照に更新

**v1.3での変更点:**
* §22 stockType を実装済みの3値へ変更(PM決定 DEC-06)

---

# 1. 目的

本システムは、家庭内の以下の情報を一元管理し、AIを利用して入力・検索・提案を効率化することを目的とする。

* 家計・支出
* 食品・日用品の在庫
* 買い物リスト
* 献立・レシピ
* レシート情報
* 将来的なGoogle Calendar / Gmail / Drive連携

本システムは、AIによる完全自動化を目的としない。

基本原則は以下とする。

> **AIは判断を補助し、GASがルールを実行し、ユーザーが重要な最終判断を行う。**

---

# 2. 対象ユーザー

MVPでは個人または家族での利用を想定する。

大規模な企業利用、複雑な権限管理、多数ユーザー向けSaaS化はMVPの対象外とする。

---

# 3. MVPの対象範囲

MVPでは以下を対象とする。

1. レシート画像入力
2. GeminiによるレシートOCR
3. OCR結果の構造化
4. ユーザーによる確認・修正
5. 家計簿への登録
6. 食品・日用品在庫への登録
7. 在庫状態の確認
8. 買い物リストへの登録
9. 献立・レシピ提案
10. レスポンシブWeb UI

---

# 4. MVPの非対象

以下はMVPでは実装しない。

* リアルタイムAR
* 高度な会計ソフト連携
* 銀行口座の自動接続
* Gmailの自動処理
* Google Calendarへの自動登録
* 複数家庭・多数テナント向け認証基盤
* 高度な商品マスタ管理
* 完全自動の買い物発注
* AIによる確認なしの重要データ確定

将来必要になった場合に拡張できる構造だけを確保する。

---

# 5. システムアーキテクチャ

基本構成は以下とする。

```
[Browser Web App]
       |
       | google.script.run
       v
[Google Apps Script]
       |
       +---- [Gemini API]
       |
       +---- [Google Spreadsheet]
       |
       +---- [Google Drive]
```

将来的に必要になった場合はCloud Run等へのバックエンド移行を妨げない構造とする。

---

# 6. フロントエンド

以下を採用する。

* HTML
* CSS
* JavaScript
* Tailwind CSS
* Browser Web App

PC・スマートフォン・タブレットで利用可能なレスポンシブUIとする。

---

# 7. バックエンド

Google Apps Scriptを使用する。

GASは以下を担当する。

* API呼び出し
* 業務ルール
* 入力値検証
* Spreadsheet読み書き
* Drive操作
* Geminiレスポンス検証
* データ正規化
* エラー処理

---

# 8. AIの責務

Geminiは以下を担当する。

* OCR
* 商品・カテゴリ候補の抽出
* レシート内容の構造化
* レシピ検索・提案
* 献立候補生成
* 補助的な分類・推定

GeminiはSpreadsheetを直接更新しない。

---

# 9. AIと業務ロジックの分離

AIの出力をそのまま業務データとして確定してはならない。

基本フローは以下とする。

```
Gemini
  ↓
構造化された候補
  ↓
GASによる検証・ルール適用
  ↓
ユーザー確認
  ↓
確定
  ↓
Spreadsheet更新
```

---

# 10. レシートOCR

スマートフォンのカメラまたは画像ファイルからレシートを入力する。

基本フロー：

```
撮影
 ↓
ブラウザ側で画像最適化
 ↓
Base64化
 ↓
GAS
 ↓
Gemini multimodal
 ↓
Structured Output
 ↓
GAS検証
 ↓
確認画面
 ↓
ユーザー修正
 ↓
確定保存
```

---

# 11. レシート画像のサイズ最適化

スマートフォンで撮影した原画像をそのままGASへ送信しない。

ブラウザ側で以下を行う。

* 必要に応じたリサイズ
* JPEG等への圧縮
* 不要な高解像度の削減
* その後Base64化

目的は以下である。

* GASへの転送データ量削減
* V8メモリ使用量削減
* 実行時間短縮
* タイムアウトリスク低減

具体的な最大画像サイズ・圧縮率は実装タスク(TASK-002)で決定する。

---

# 12. OCR Structured Output

GeminiのOCR結果は自由形式テキストではなく、定義済みJSON Schemaに従わせる。

概念例：

```json
{
  "receipt": {
    "date": "...",
    "store": "...",
    "total": 0
  },
  "items": [
    {
      "name": "...",
      "quantity": 1,
      "unitPrice": 0,
      "amount": 0,
      "category": "...",
      "stockType": "ingredient"
    }
  ]
}
```

実際のSchemaは `docs/GEMINI_SCHEMA.md` をSSOTとする。

---

# 13. OCR結果の検証

GAS側で以下を検証する。

* 必須項目
* 型
* 金額
* 数量
* JSON Schema
* 想定外フィールド
* null / 空文字
* Gemini APIエラー

Schemaに適合しない場合、データ確定処理を行わない。

---

# 14. ユーザー確認

OCR結果は確認画面を経由する。

ユーザーは必要に応じて以下を修正できる。

* 店舗名
* 日付
* 商品名
* 数量
* 金額
* カテゴリ
* 在庫対象／非対象

確認完了後に初めてSpreadsheetへ確定保存する。

---

# 15. 商品名正規化

レシートOCRでは同一商品が異なる名称で認識される可能性がある。

例：

```
豚バラ肉
豚バラ
国産豚バラ
豚バラ薄切り
```

これらが別々の商品として登録されると在庫管理の精度が低下する。

そのため、将来的に以下の概念を導入可能なデータ構造とする。

```
商品マスタ
- product_id
- canonical_name
- category
- aliases
- unit
- stockType
```

ただし、商品マスタそのものはTASK-00では実装しない。TASK-005では商品名の完全一致ベースの簡易照合までを対象とし、商品マスタの本体実装は将来の別タスクとする。

---

# 16. 商品名正規化の責務

商品名正規化はGeminiだけに依存しない。

基本方針：

```
Gemini
 ↓
商品名・カテゴリ候補
 ↓
GAS
 ↓
既存商品マスタ・カテゴリマスタとの照合
 ↓
候補
 ↓
ユーザー確認
```

AIの推測だけで既存商品を上書き・統合しない。

---

# 17. Spreadsheet構成

MVPでは以下のシートを使用する。

* 支出明細
* 在庫一覧
* 在庫履歴
* 買い物リスト
* 献立履歴

将来的に必要に応じて、

* 商品マスタ
* カテゴリマスタ
* 設定

を追加可能とする。

---

# 18. Spreadsheetデータ原則

Spreadsheetは単なる表示用表ではなく、構造化データベースとして扱う。

原則：

* 1行 = 1レコード
* 固有IDを持つ
* 行番号をIDとして扱わない
* 日付・金額・数量の型を統一
* 履歴と現在状態を分離
* 列構造を勝手に変更しない

---

# 19. 固有ID

各レコードには安定したIDを付与する。

例：

* expense_id
* inventory_id
* shopping_id
* menu_id

IDはSpreadsheetの行番号に依存しない。

---

# 20. 在庫一覧

現在の在庫状態を保持する。

例：

* inventory_id
* product_id
* name
* category
* quantity
* unit
* stockType
* status
* updated_at

`status` の例：

* 多
* 普通
* 少
* なし

---

# 21. 在庫履歴

在庫変更履歴を別シートに記録する。

目的：

* 変更履歴確認
* 誤登録調査
* 将来的な分析
* 現在在庫との分離

---

# 22. stockType
在庫対象を区別するため `stockType` を使用する。
値(v1.3で確定):
* `ingredient`:食品・食材(在庫対象)
* `daily`:日用品・消耗品(在庫対象)
* `other`:その他(在庫非対象)
これにより食品と日用品を同じ在庫システムで扱える。
日用品の細分類が必要になった場合は、別途仕様変更として扱う。

---

# 23. 買い物リスト

在庫が「なし」またはユーザーが必要と判断した商品を買い物リストへ登録できる。

在庫状態から自動候補を生成することは可能だが、購入確定はユーザー操作を基本とする。

---

# 24. 献立提案

Geminiに以下の情報を渡して献立を提案する。

* 現在庫
* 消費期限等の情報
* ユーザー条件
* 必要に応じたWeb検索結果

出力例：

* 主菜
* 副菜
* 汁物
* 不足食材

---

# 25. Google Search Grounding

レシピや商品情報等の最新Web情報が必要な場合はGeminiのGoogle Search Groundingを利用する。

検索結果を利用した提案では、可能な限り参照元をユーザーに提示する。

AIが生成した提案とWeb上の情報を混同しないUIとする。

---

# 26. 献立履歴

提案・採用した献立を記録する。

将来的に、

* よく作る料理
* 食材消費傾向
* 献立ローテーション

等へ拡張可能とする。

---

# 27. Google Drive

レシート画像等のファイル保存先としてGoogle Driveを利用する。

Spreadsheetには必要に応じてDriveファイルIDまたはURLを保持する。

画像そのものをSpreadsheetセルに保存しない。

---

# 28. Google Calendar / Gmail

将来拡張対象とする。

想定用途：

* 献立予定
* 買い物予定
* 賞味期限リマインド
* Gmailからの購入情報取得

MVPでは実装しない。

---

# 29. データ整合性

Geminiから受け取ったデータはGAS側で検証する。

GASは以下を保証する。

* Schema検証
* 必須項目検証
* 型検証
* 業務ルール検証
* 不正データの拒否

---

# 30. Spreadsheet APIアクセス

Spreadsheet APIは原則としてバッチ処理する。

推奨：

```
getValues()
 ↓
メモリ上で処理
 ↓
setValues()
```

禁止：

```
for (...)
  getValue()
  setValue()
```

ループ内でSpreadsheet APIを繰り返し呼び出す実装は原則禁止とする。

---

# 31. エラー処理

エラーは以下に分類する。

* 入力エラー
* Gemini APIエラー
* Schemaエラー
* Spreadsheetエラー
* Driveエラー
* システムエラー

AIの生エラーメッセージをそのままユーザーへ表示しない。

---

# 32. セキュリティ

APIキー等の秘密情報をGitへ保存しない。

GASでは `PropertiesService` 等を利用する。

Spreadsheet ID、Drive ID等の環境依存値もコードへ直接埋め込まないことを基本とする。

---

# 33. 開発プロジェクト

Git上では以下の構成を基本とする。

```
home-ai-assistant/
├─ README.md
├─ Gemini.md
├─ Qwen_REVIEW.md
├─ docs/
│  ├─ SPEC.md
│  ├─ DEVELOPMENT.md
│  ├─ TASK_PLAN.md
│  ├─ DATA_MODEL.md
│  ├─ GEMINI_SCHEMA.md
│  ├─ GAS_MANUAL_DEPLOY.md
│  ├─ GAS_TEST_PLAN.md
│  └─ GAS_TEST_REPORT.md
├─ src/
│  ├─ Code.gs
│  ├─ GeminiService.gs
│  ├─ ReceiptService.gs
│  ├─ ExpenseService.gs
│  ├─ InventoryService.gs
│  ├─ ShoppingService.gs
│  ├─ RecipeService.gs
│  ├─ SheetRepository.gs
│  └─ DriveService.gs
├─ web/
│  ├─ index.html
│  ├─ app.js
│  └─ styles.html
└─ tests/
```

`docs/TASK_PLAN.md` を新規追加し、TASK-001以降の詳細なタスク定義(目的・対象ファイル・変更許可/禁止ファイル・完了条件・テスト条件・証拠・レビュー強度)のSSOTとする。

---

# 34. GitをSSOTとする

Gitリポジトリを開発上の唯一の正本とする。

GASプロジェクトは実行環境であり、SSOTではない。

---

# 35. GASへの同期

TASK-00以降、claspを利用する。

基本フロー：

```
Git
 ↓
Gemini実装
 ↓
Qwenレビュー
 ↓
PM承認
 ↓
git commit
 ↓
clasp push
 ↓
GAS実行環境
 ↓
実機テスト
```

---

# 36. GAS IDE直接編集禁止

原則としてGAS IDE上でコードを直接修正しない。

GAS側で直接修正した場合は、その変更を正式なGit側へ戻し、SSOTを一致させてから次の作業へ進む。

---

# 37. clasp

claspを開発基盤として採用する。

TASK-00で以下を確立する。

* clasp設定
* GASプロジェクトとの紐付け
* Git → GAS同期
* GAS側変更の扱い
* `.claspignore` 等の設定
* 認証方法

**TASK-000は完了済み。** 確立内容の詳細・証拠は `docs/DEVELOPMENT.md` および `docs/GAS_TEST_REPORT.md` を参照する。

---

# 38. MVPロードマップ

**本章の詳細な作業内容(各タスクの目的・対象ファイル・変更許可/禁止ファイル・完了条件・テスト条件・証拠・レビュー強度)は `docs/TASK_PLAN.md` をSSOTとする。**

本章では全体の流れのみを示す。

| TASK | 内容 | 状態 |
|---|---|---|
| TASK-000 | 開発基盤・運用基盤 | **完了** |
| TASK-001 | Gemini Structured Output基盤 | 未着手 |
| TASK-002 | レシートOCR | 未着手 |
| TASK-003 | OCR確認UI | 未着手 |
| TASK-004 | 家計簿登録 | 未着手 |
| TASK-005 | 在庫連動 | 未着手 |
| TASK-006 | 買い物リスト | 未着手 |
| TASK-007 | 献立・レシピ提案 | 未着手 |
| TASK-008 | 実機総合検証 | 未着手 |

番号は実装状況に応じて調整可能とする。個々のタスクの着手前には、必ず `docs/TASK_PLAN.md` の該当タスク定義を確認する。

---

# 39. MVP完了条件

以下を満たした時点でMVP完了とする。

* レシート画像をスマートフォンから入力できる
* OCR結果が構造化される
* OCR結果をユーザーが確認・修正できる
* 家計簿へ登録できる
* 在庫へ登録できる
* 在庫状態を確認できる
* 買い物リストを利用できる
* 献立提案を利用できる
* PC・スマートフォン双方で利用できる
* GitとGASの状態が一致している
* 実機テストを完了している

---

# 40. 設計原則

本システムの最重要原則を以下に定める。

> **AIの曖昧さを、GASの厳格なルールとUIの確認ステップで制御する。**

さらに、

> **AIは判断を補助し、GASがルールを実行し、ユーザーが重要な最終判断を行う。**

これを全実装・全タスクの共通原則とする。
