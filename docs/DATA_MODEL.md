# データモデル定義書 (DATA_MODEL.md)

## 1. 概要と位置づけ

本書は、「Google統合型 家計・在庫・献立アシスタント」における Google Spreadsheet 上のデータモデルおよび各シート構造を定義する **SSOT（Single Source of Truth）** である。

- **初版策定タスク**: `TASK-004` (家計簿登録・SheetRepository基盤)
- **関連ドキュメント**:
  - `docs/SPEC.md` (§17 Spreadsheet構成, §18 データ原則, §19 固有ID, §30 バッチアクセス)
  - `docs/TASK_PLAN.md` (TASK-004, TASK-005, TASK-006)
  - `docs/GEMINI_SCHEMA.md` (ReceiptOcrSchema との項目対応)

---

## 2. 全体データ原則 (SPEC.md §18, §19 準拠)

1. **1行 = 1レコード**: 複数明細を1行に結合せず、商品1件につき1行を保持する。
2. **固有IDの保持**: 各レコードは行番号に依存しない一意なID（`expense_id` 等）を必ず持つ。
3. **行番号依存の禁止**: 行番号をIDとして扱わない。行の並び替え・削除・挿入が発生してもIDの同一性を維持する。
4. **型の一貫性**: 日付（文字列 `YYYY-MM-DD`）、数値（数量・単価・金額）の型を統一する。
5. **列構造の固定**: システム外から勝手に列順序や列ヘッダーを変更しない。
6. **バッチ処理**: Spreadsheet API は `getValues()` / `setValues()` による一括処理を原則とし、ループ内の逐次 `getValue()` / `setValue()` / `appendRow()` を禁止する。

---

## 3. 「支出明細」シート (TASK-004 確定)

### 3.1 シート仕様
- **シート名**: `支出明細`
- **目的**: レシートOCRで読み取り、ユーザーが確認・確定した購入商品ごとの支出データを記録する。
- **ヘッダー行**: 1行目
- **データ開始行**: 2行目

### 3.2 列定義一覧

| 列番号 | 列名 (ヘッダー) | 内部キー | 型 | 必須 | 制約・形式 | 説明 |
|:---:|---|---|---|:---:|---|---|
| **A** | `expense_id` | `expense_id` | string | ○ | 一意（重複不可）<br>`EXP-YYYYMMDD-HHMMSS-NNN-XXXX` | レコード固有ID（行番号非依存） |
| **B** | `日付` | `date` | string | ○ | `YYYY-MM-DD` 形式 | 購入日（レシート記載日） |
| **C** | `店舗名` | `store` | string | ○ | 1文字以上 | 購入店舗名 |
| **D** | `商品名` | `name` | string | ○ | 1文字以上 | 商品名 |
| **E** | `カテゴリ` | `category` | string | ○ | `食費`, `日用品`, `その他` | 支出カテゴリ区分 |
| **F** | `数量` | `quantity` | number | ○ | 1以上の正の整数 | 購入数量 |
| **G** | `単価` | `unitPrice` | number | ○ | 0以上の数値 | 1個あたりの価格 |
| **H** | `金額` | `amount` | number | ○ | 0以上の数値 | 明細行の小計（合計額） |
| **I** | `receipt_drive_id` | `receipt_drive_id` | string | - | 任意の文字列（未保存時は空文字 `""`） | Google Drive上のレシート画像ID（TASK-004では `""`） |

### 3.3 TASK-003（OCR確認データ）との項目対応関係

TASK-003 でユーザーが確認・修正したデータ構造（`ReceiptOcrSchema`）と「支出明細」シートの列は、以下の通り1対1で対応する。

```text
[TASK-003 確認済みデータ]                       [支出明細シート]
confirmedData.date           ───────────>  B列: 日付
confirmedData.store          ───────────>  C列: 店舗名
item.name                    ───────────>  D列: 商品名
item.category                ───────────>  E列: カテゴリ
item.quantity                ───────────>  F列: 数量 (整数)
item.unitPrice               ───────────>  G列: 単価
item.amount                  ───────────>  H列: 金額 (小計)
(新規発番)                   ───────────>  A列: expense_id
(空文字: "" ※Drive保存対象外) ───────────>  I列: receipt_drive_id
```

- **数量・単価・金額の整合性**:
  - `quantity`: 数量（1以上の整数）
  - `unitPrice`: 単価（1個あたりの価格）。ユーザーが数量または小計を修正した行は、小計÷数量(四捨五入)で再導出する（未修正行はOCR値を保持）。
  - `amount`: 金額（明細の小計）
  - TASK-003で確定された意味をそのまま継承し、勝手な意味変更や再計算は行わない。
- **日付列の書き込み形式**:
  - B列（日付）は、スプレッドシートの自動日付変換による誤認識を防ぐため、書式なしテキスト（`setNumberFormat('@')`）として書き込む。

---

## 4. `expense_id` 発番仕様 (TASK-004 確定)

### 4.1 フォーマット
```text
EXP-YYYYMMDD-HHMMSS-NNN-XXXX
```
- `EXP-`: 支出レコード識別プレフィックス
- `YYYYMMDD`: 登録実行日（JST）
- `HHMMSS`: 登録実行時刻（JST）
- `NNN`: バッチ内3桁連番（`001`, `002`, ...）※同一レシート内で複数品目を登録する際の一意性を保証
- `XXXX`: 4文字の暗号学的に安全/高エントロピーなランダム英数字（同時実行時の衝突を防止）

### 4.2 特徴・保証
- **行番号非依存**: Spreadsheet の行番号（`row 2`, `row 3` 等）をIDとして絶対に使用しない。
- **一意性保証**: タイムスタンプ + バッチ内連番 + ランダム英数字により、同一バッチ内でも同時実行時でも重複しない。
- **冪等性・追跡性**: 登録されたレコードは将来的な削除・ソートを行ってもIDが変わらない。

---

## 5. 後続タスクでの追加予定シート一覧

| シート名 | 担当タスク | 主な管理項目 | 状態 |
|---|:---:|---|:---:|
| **支出明細** | **TASK-004** | `expense_id, 日付, 店舗名, 商品名, カテゴリ, 数量, 単価, 金額, receipt_drive_id` | **確定 (TASK-004)** |
| **在庫一覧** | TASK-005 | `inventory_id, product_id, name, category, quantity, unit, stockType, status, updated_at` | 未着手 (TASK-005) |
| **在庫履歴** | TASK-005 | `history_id, inventory_id, change_type, change_amount, reason, created_at` | 未着手 (TASK-005) |
| **買い物リスト** | TASK-006 | `shopping_id, name, category, quantity, status, created_at` | 未着手 (TASK-006) |
| **献立履歴** | TASK-007 | `menu_id, date, meal_type, main_dish, side_dishes, recipe_ids` | 未着手 (TASK-007) |
