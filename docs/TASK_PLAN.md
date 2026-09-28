# Google統合型 家計・在庫・献立アシスタント

## TASK_PLAN — TASK-001〜TASK-008 作業計画 v1.2

**作成日:** 2026-09-25
**更新日:** 2026-09-28
**対象:** `docs/SPEC.md` v1.3 / `docs/DEVELOPMENT.md` v1.4 に基づく個別タスク定義
**位置づけ:** 本書は `docs/DEVELOPMENT.md` 第11章で定める「タスク単位の変更管理」項目(TASK-ID/目的/対象ファイル/変更許可ファイル/変更禁止ファイル/完了条件/テスト条件/証拠)のSSOTとする。

**v1.1での変更点:**
* TASK-004「変更許可ファイル」に `src/Code.gs`(confirmReceiptDataの接続のみ)を追記
* TASK-005「実装内容」2の stockType 列挙を `ingredient/daily/other` に変更

**v1.2での変更点:**
* TASK-004-FIXの追加(PM決定 DEC-01〜DEC-06)

**前提:** TASK-000(開発基盤・運用基盤構築)は完了済み。以下はTASK-001以降の作業内容である。依存関係は基本的に直列(TASK-006はTASK-005に依存、TASK-007はTASK-005に依存)。

各タスク着手前に、`docs/DEVELOPMENT.md` 第4章の開発フロー(タスク仕様確定→Gemini実装指示→…→Task Complete)に従うこと。

---

# TASK-001:Gemini Structured Output基盤

## 目的

以降の全タスク(OCR/献立提案等)が共通利用する、Gemini API呼び出し・JSON Schema準拠出力・エラー分類の基盤(`GeminiService.gs`)を構築する。まだ業務ロジックには接続しない。

## 対象ファイル

* `src/GeminiService.gs`(新規)
* `docs/GEMINI_SCHEMA.md`(新規・雛形のみ、正式化はTASK-002以降)

## 変更許可ファイル

上記2点のみ。

## 変更禁止ファイル

`web/` 配下、他の `*Service.gs`(未作成含む)、`src/Code.gs`

## 実装内容

1. `PropertiesService` によるAPIキー管理(コード直書き禁止。`docs/DEVELOPMENT.md` §34,§35準拠)
2. `callGeminiStructured(prompt, schema, options)`:テキスト/multimodal両対応、JSON Schema指定
3. リトライ(指数バックオフ、上限2〜3回)・タイムアウト処理
4. エラー分類(Gemini APIエラー/Schemaエラー/システムエラー。`docs/SPEC.md` §31準拠。生エラーをそのまま返さない)
5. 汎用的な構造検証(必須キー存在・JSON.parse成功可否)のみ実装。業務ルール検証は各タスクの担当範囲とする。

## 完了条件

* テスト呼び出しで期待通りのJSON構造が返る
* APIキーがコードに存在しない
* 異常系で分類済みエラーオブジェクトが返る

## テスト条件

* 単体:モック応答でのSchema検証ロジック確認
* 実機:実際のGemini APIへの疎通確認(GAS実行環境)
* 異常系:不正応答/APIエラー時の挙動確認

## 証拠

Git diff、GAS実行ログ、`docs/GAS_TEST_REPORT.md` 記録

## Qwenレビュー強度

Level A(Gemini API連携・共通サービス変更)

---

# TASK-002:レシートOCR

## 目的

TASK-001の基盤で、レシート画像→構造化JSON取得までを実装する。Spreadsheetへはまだ書き込まない(確定保存はTASK-004)。

## 対象ファイル

* `src/ReceiptService.gs`(新規)
* `docs/GEMINI_SCHEMA.md`(receipt schema確定・更新)
* `web/index.html`, `web/app.js`(画像入力・最適化UIのみ、確認画面はTASK-003)
* `src/Code.gs`(エントリーポイント関数追加)

## 変更許可ファイル

上記4点のみ。

## 変更禁止ファイル

`ExpenseService.gs` 以降(未作成)、`SheetRepository.gs`

## 実装内容

1. ブラウザ側:撮影→リサイズ→圧縮→Base64化(`docs/SPEC.md` §11準拠。具体的サイズ/圧縮率は実測して決定)
2. GAS側:`receiveReceiptImage(base64Image)` → `GeminiService` のmultimodal呼び出し
3. receipt schemaの正式確定(店舗名/日付/商品名/数量/単価/金額/カテゴリ/stockType)
4. OCR結果のGAS側検証(必須項目・型・金額・数量・Schema適合・null/空文字。`docs/SPEC.md` §13準拠)
5. Schema不適合時は確定処理へ進めない

## 完了条件

* スマホ実機でレシート撮影→送信→構造化JSON取得が動作する
* 転送前に画像が最適化されている
* Schema不適合が正しく検知される

## テスト条件

* 実機:異なる店舗・レイアウトのレシート複数枚
* 大きい画像でのタイムアウト有無確認
* 異常系:意図的にSchema不適合を発生させ挙動確認

## 証拠

実機テストのスクリーンショット、OCR結果ログ、`docs/GAS_TEST_REPORT.md`

## Qwenレビュー強度

Level A(OCR・Gemini API連携・データモデル)

---

# TASK-003:OCR確認UI

## 目的

OCR結果をユーザーが確認・修正できる画面を実装する。確定操作までSpreadsheetへ反映しない(`docs/SPEC.md` §14準拠)。

## 対象ファイル

* `web/index.html`, `web/app.js`, `web/styles.html`
* `src/Code.gs`(確定操作の呼び出し口のみ。保存ロジック本体はTASK-004)

## 変更許可ファイル

上記4点のみ。

## 変更禁止ファイル

`src/ExpenseService.gs`(TASK-004で新規作成予定)、`src/SheetRepository.gs`(同上)

## 実装内容

1. 店舗名/日付/商品明細(名前・数量・金額・カテゴリ・在庫対象/非対象)の編集可能な一覧表示
2. stockType選択UI
3. 「確定」ボタン押下前は書き込み処理を一切呼ばない
4. PC/スマホ/タブレット対応のレスポンシブUI

## 完了条件

* 全項目を確認・修正できる
* 確定前は何もSpreadsheetに反映されない
* 主要画面サイズで崩れない

## テスト条件

実機での修正操作、レスポンシブ確認(PC/スマホ/タブレット)

## 証拠

PC/スマホのスクリーンショット

## Qwenレビュー強度

Level B(UIロジック中心)

---

# TASK-004:家計簿登録

## 目的

確定済みOCR結果を「支出明細」シートへ登録する。`SheetRepository.gs` によるSpreadsheetアクセス集約もここで確立する。

## 対象ファイル

* `src/ExpenseService.gs`(新規)
* `src/SheetRepository.gs`(新規)
* `docs/DATA_MODEL.md`(支出明細データモデル確定)

## 変更許可ファイル

上記3点、および `src/Code.gs`(confirmReceiptDataの接続のみ)。

## 変更禁止ファイル

`src/InventoryService.gs` 以降(未作成)

## 実装内容

1. `SheetRepository.gs` 基盤構築(業務サービスが直接Spreadsheet APIを多用しない構造。`docs/DEVELOPMENT.md` §33準拠)
2. 支出明細シート列確定:`expense_id, 日付, 店舗名, 商品名, カテゴリ, 数量, 単価, 金額, receipt_drive_id` 等
3. `expense_id` 発番(行番号非依存。`docs/SPEC.md` §19準拠)
4. `getValues()` → メモリ処理 → `setValues()` のバッチ処理(ループ内 `getValue/setValue` 禁止。`docs/SPEC.md` §30準拠)
5. Gemini→Schema検証→業務ルール検証→Repository→Spreadsheetの順序厳守(`docs/DEVELOPMENT.md` §32準拠)

## 完了条件

* 確定操作で支出明細に正しく登録される
* IDが重複なく発番される
* コードレビューでループ内逐次API呼び出しがないことを確認

## テスト条件

複数レコード同時登録の性能確認、同時実行時のID重複確認、実機での登録確認

## 証拠

Spreadsheet登録前後のスクリーンショット、Git diff

## Qwenレビュー強度

Level A(Spreadsheetデータ更新・データモデル変更)

---

# TASK-004-FIX

## 目的

TASK-004の遡及レビューで確認された不具合(確定UIの偽成功等)と、データ整合性・セキュリティの指摘を修正する。新機能・リファクタリングは行わない。

## 対象ファイル

* `docs/TASK_PLAN.md`(Step 0のみ)
* `web/app.html`
* `src/SheetRepository.gs`
* `src/ExpenseService.gs`
* `src/Code.gs`(必要な場合のみ。エラー応答の整形に限る)
* `docs/DATA_MODEL.md`

## 変更許可ファイル

上記6点のみ。docs/TASK_PLAN.md は TASK-004-FIX 節の追加と版数更新のみ(他の節は変更禁止)。

## 変更禁止ファイル

src/GeminiService.gs, src/ReceiptService.gs, web/index.html, web/styles.html, appsscript.json, .claspignore, docs/SPEC.md, docs/DEVELOPMENT.md, docs/GAS_TEST_REPORT.md, Qwen_REVIEW.md、その他すべて

## 実装内容

Step 1 [DEC-01] 確定処理の応答判定(web/app.html):
confirmReceiptDataToGas の resolve 値について、`res && res.ok === true` かつ `res.data && typeof res.data.registeredCount === 'number'` のときのみ成功表示を行う。それ以外は失敗として扱う。失敗時は、汎用メッセージ「保存に失敗しました。時間をおいて再度お試しください。」を表示し、確定ボタンを再有効化する。res.error.message などの生メッセージは表示しない。成功時は「✅ N件の支出明細を保存しました。」(N = res.data.registeredCount)を表示する。「TASK-004で実行されます」の文言を削除する。

Step 2 [DEC-02] unitPrice 導出(web/app.html):
OCR結果の該当行と比較して、数量または小計が修正された行のみ unitPrice = Math.round(小計 ÷ 数量) を送る。未修正行はOCR値を保持する。判定ロジックは純粋関数(例:deriveUnitPrice)に切り出し、既存の module.exports に追加する。

Step 3 [DEC-03] 排他制御(src/SheetRepository.gs):
appendExpenseRows の getLastRow〜setValues を LockService.getScriptLock() で囲む(waitLock 10秒程度、finally で releaseLock)。取得失敗時は ok:false の分類済みエラーを返す。モック/非GAS環境では LockService 未定義でも動作するようガードする。appsscript.json の変更が必要な場合は変更せず、PMへ報告する。

Step 4 [DEC-04] 日付列(src/SheetRepository.gs):
書き込む範囲の日付列(B列)を setNumberFormat('@') にしてから setValues する。バッチ性(ループ内API呼び出し禁止)を維持する。

Step 5 [DEC-05] エラー文(src/SheetRepository.gs, src/ExpenseService.gs, src/Code.gs):
ユーザーへ返す message は汎用文言にし、err.message は console.error のみへ出す。error.type による分類は維持する。

Step 6 docs/DATA_MODEL.md:
§3.3 の unitPrice の規定に「ユーザーが数量または小計を修正した行は、小計÷数量(四捨五入)で再導出する」を追記する(他の記述は変更しない)。日付列を書式なしテキストで書き込む旨も追記する。

## 完了条件

* 保存失敗時に成功表示が出ず、ボタンが再有効化される
* 「TASK-004で実行されます」の文言が存在しない
* 修正行のunitPriceが再導出され、未修正行はOCR値のまま保存される
* 追記処理がロックで保護され、ロック失敗時に分類済みエラーが返る
* 日付が文字列として保存される
* 生エラー文がUIへ返らない

## テスト条件

* 単体(モック):ok:false 時のUI分岐、deriveUnitPrice、ロック失敗経路、エラー文の汎用化
* 実機(PMの別途指示で実施。本タスクでは実施しない)

## 証拠

git diff、単体テスト結果

## Qwenレビュー強度

Level A(Spreadsheetデータ更新・エラー処理・確定契約)

---

# TASK-005:在庫連動

## 目的

家計簿登録と連動し、在庫一覧・在庫履歴への反映を実装する。

## 対象ファイル

* `src/InventoryService.gs`(新規)
* `docs/DATA_MODEL.md`(在庫一覧/在庫履歴データモデル追記)

## 変更許可ファイル

上記2点のみ。

## 変更禁止ファイル

`src/ExpenseService.gs`、`src/SheetRepository.gs`(構造変更を伴う修正は不可。呼び出しのみ許可)

## 実装内容

1. 在庫一覧・在庫履歴シート列確定(`inventory_id, product_id, name, category, quantity, unit, stockType, status, updated_at` 等。`docs/SPEC.md` §20,§21準拠)
2. stockType区分実装(`ingredient/daily/other`。`docs/SPEC.md` §22準拠)
3. 商品名の簡易照合(完全一致ベースの最小実装。本格的な商品マスタ照合は将来タスクとして明示的に対象外とする。`docs/SPEC.md` §15,§16準拠)
4. 現在状態(在庫一覧)と履歴(在庫履歴)の分離書き込み
5. status(多/普通/少/なし)の暫定しきい値判定ロジック(設定変更可能に)

## 完了条件

* 家計簿登録と連動して在庫一覧・履歴が更新される
* stockTypeによる区別が機能する
* ユーザーが在庫状態を一覧確認できる

## テスト条件

同一商品複数回登録時の数量累積確認、商品名表記揺れ時の挙動確認(既知の限界として記録)、実機確認

## 証拠

Spreadsheetスクリーンショット

## Qwenレビュー強度

Level A(在庫ロジック・データモデル変更)

---

# TASK-006:買い物リスト

## 目的

在庫状態またはユーザー判断に基づく買い物リストの登録・管理を実装する。

## 対象ファイル

* `src/ShoppingService.gs`(新規)
* `web/index.html`, `web/app.js`(買い物リストUI)

## 変更許可ファイル

上記3点のみ。

## 変更禁止ファイル

`src/InventoryService.gs`(参照のみ許可、ロジック変更不可)

## 実装内容

1. 買い物リスト列確定:`shopping_id, 商品名, カテゴリ, 数量目安, 優先度, 追加日, 状態` 等
2. 在庫「なし」商品からの自動候補提示(購入確定は必ずユーザー操作。`docs/SPEC.md` §23準拠。自動書き込みしない)
3. 手動追加・削除・購入済みマーク機能

## 完了条件

在庫「なし」候補が提示され、ユーザー確認を経てのみ追加される。手動操作が機能する。

## テスト条件

TASK-005からの候補生成確認、実機でのスマホ操作確認

## 証拠

UIスクリーンショット

## Qwenレビュー強度

Level B(通常業務ロジック)

---

# TASK-007:献立・レシピ提案

## 目的

現在庫等を踏まえGeminiへ献立提案を依頼し、結果提示と履歴記録を行う。

## 対象ファイル

* `src/RecipeService.gs`(新規)
* `docs/GEMINI_SCHEMA.md`(献立提案schema追加)
* `web/index.html`, `web/app.js`(提案UI)

## 変更許可ファイル

上記4点のみ。

## 変更禁止ファイル

`src/InventoryService.gs`(参照のみ許可)

## 実装内容

1. 現在庫データ・消費期限情報・ユーザー条件を渡すプロンプト構築
2. 必要に応じGoogle Search Grounding利用、参照元の明示(`docs/SPEC.md` §25準拠。AI生成提案とWeb情報を混同しないUI設計)
3. 提案schema確定(主菜/副菜/汁物/不足食材)
4. 献立履歴シートへの記録(`docs/SPEC.md` §26準拠)

## 完了条件

* 在庫を考慮した提案が返る
* Web検索利用時に参照元が明示される
* 採用した献立が履歴記録される

## テスト条件

在庫多寡それぞれでの提案妥当性確認、Grounding利用時の参照元表示確認、実機確認

## 証拠

提案結果スクリーンショット

## Qwenレビュー強度

Level A(Gemini API連携・外部サービス連携)。ただしUI部分のみLevel B相当とする。

---

# TASK-008:実機総合検証

## 目的

TASK-001〜007を通し、`docs/SPEC.md` §39のMVP完了条件を満たすか総合検証する。原則コード変更は行わず、問題発見時は該当タスクへ差し戻す。

## 対象ファイル

なし。修正が必要な場合は元タスクの対象ファイルに限定する。

## 変更許可ファイル

なし(差し戻し先の各タスク定義に従う)

## 変更禁止ファイル

該当なし(コード変更自体を原則行わない)

## 実装内容

1. レシート入力→OCR→確認→家計簿登録→在庫反映→買い物リスト→献立提案の一連シナリオテスト
2. PC/スマホ双方での動作確認
3. GitとGASの同期状態確認(`docs/DEVELOPMENT.md` §10準拠)
4. `docs/SPEC.md` §39の全項目をチェックリスト化して確認

## 完了条件

`docs/SPEC.md` §39全項目達成

## テスト条件

複数店舗・複数商品パターンでの通しシナリオ

## 証拠

総合テストレポート(`docs/GAS_TEST_REPORT.md`)

## Qwenレビュー強度

各タスクで実施済みのため、本タスクはPM最終確認中心とする。

---

# 補足事項

* 商品マスタ本体(`docs/SPEC.md` §15)は、TASK-001〜008のいずれにも本格実装として含めない。TASK-005で完全一致ベースの簡易照合のみ行い、本体実装は将来の別タスクとして切り出す。
* `docs/GEMINI_SCHEMA.md` と `docs/DATA_MODEL.md` は、TASK-001, 002, 004, 005, 007 にまたがって段階的に更新されるため、各タスクの「変更許可ファイル」に個別に含めている。共通ドキュメントであるため、更新時は既存記述を上書き削除せず追記・改訂する形とする。
* 各タスク開始前に、`docs/DEVELOPMENT.md` 第4章の手順(タスク仕様確定→Gemini実装指示)に則り、本書の該当タスク定義をそのままGeminiへの実装指示のベースとする。
* 本書の内容に変更が必要な場合は、`docs/DEVELOPMENT.md` §39(仕様変更ルール)に従い、コードを先に変更せず本書を先に更新する。
