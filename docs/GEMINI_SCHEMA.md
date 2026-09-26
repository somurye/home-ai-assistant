# Gemini JSON Schema 定義規約 (GEMINI_SCHEMA.md)

## 1. 目的と位置づけ

本書は、Google Apps Script (GAS) 環境から Google Gemini API を呼び出す際に使用する **Structured Output (JSON Schema)** の共通定義・規約の置き場（SSOT）である。

本ドキュメントは `TASK-001`（Gemini Structured Output基盤）において雛形として確立され、後続タスク（TASK-002: レシートOCR、TASK-007: 献立提案等）で各業務の正式なJSON Schemaを順次追加・確定する。

> [!NOTE]
> 本タスク（TASK-001）では特定の業務ロジックに依存する正式なレシートSchema等は確定せず、共通規約と定義用テンプレートのみを規定する。

---

## 2. Gemini Structured Output スキーマ規約

Gemini APIへ渡すJSON Schemaは、以下の基本ルールに準拠する。

### 2.1 APIパラメータ形式
- Structured Outputを要求する際、リクエストペイロード内の `generationConfig` は Google公式最新仕様（REST API `v1beta` / `generateContent`）に準拠した以下の形式を使用する：
  ```json
  "generationConfig": {
    "responseFormat": {
      "text": {
        "mimeType": "APPLICATION_JSON",
        "schema": { ... }
      }
    }
  }
  ```
- **仕様照合根拠**:
  * `generation_config.response_format.text.mime_type` は Protocol Buffer の `TextResponseFormat.MimeType` Enum型であり、Enum識別子として **`"APPLICATION_JSON"`** を指定する。
  * Google公式リファレンス（`gemini-api-reference/generate-content.md`）において、`generationConfig.responseSchema` および `_responseJsonSchema` は **`(deprecated)`** と明記されている。
  * 最新仕様ではモダリティ別設定（`ResponseFormatConfig` / `TextResponseFormat`）として `generationConfig.responseFormat.text.mimeType` および `generationConfig.responseFormat.text.schema` が正式定義されている。
- **禁止項目**: `responseJsonSchema` や `responseSchema` などの旧形式・非推奨パラメータは使用しない。

### 2.2 スキーマ構造ルール
1. **トップレベル**: 原則として `type: "object"` とする。
2. **必須項目 (`required`)**: 業務上欠落を許容しないプロパティは明示的に `required` 配列に列挙する。
3. **余計なキーの排除 (`additionalProperties`)**: 原則として `additionalProperties: false` を指定し、Geminiによる想定外フィールドの生成を防止する。
4. **型定義 (`type`)**: `string`, `number`, `integer`, `boolean`, `array`, `object` を厳格に指定する。
5. **列挙型 (`enum`)**: 定義域が固定されている区分値（カテゴリ、ステータス等）は `enum` 配列で制限する。
6. **配列の制約 (`minItems`, `items`)**: 空配列を許容しない場合は `minItems: 1` を明示し、要素スキーマは `items` に定義する。
7. **形式制約 (`pattern`)**: 日付形式（`YYYY-MM-DD`）等の文字列形式は正規表現 `pattern` で制約する。

---

## 3. スキーマ定義テンプレート（雛形）

後続タスクで新しいStructured Outputを定義する際は、以下の基本雛形を利用する。

```json
{
  "type": "object",
  "required": ["fieldA", "fieldB"],
  "additionalProperties": false,
  "properties": {
    "fieldA": {
      "type": "string",
      "description": "項目の説明"
    },
    "fieldB": {
      "type": "number",
      "minimum": 0,
      "description": "数値項目の説明"
    },
    "status": {
      "type": "string",
      "enum": ["ACTIVE", "INACTIVE"],
      "description": "ステータス区分"
    }
  }
}
```

---

## 4. 業務ルール検証との境界

Gemini APIから取得したStructured Outputの検証は、2段階の責務分離で行う：

```text
[Gemini API]
     ↓ (JSON文字列)
[GeminiService: 汎用構造検証]
  - JSON parse
  - 型チェック (type)
  - 必須キー存在確認 (required)
  - 未定義キー拒否 (additionalProperties)
  - 境界値・列挙値・パターン検証 (minimum, minItems, enum, pattern)
     ↓ (検証済み候補データ)
[各業務Service: 業務ルール検証]  ※後続タスクで実装
  - 金額・数量の業務的妥当性
  - 日付の整合性（未来日チェック等）
  - 商品名マスタとの突合・正規化
  - 在庫管理対象区分の判定
```

---

## 5. TASK-002 正式スキーマ: ReceiptOcrSchema

レシート画像から店舗名、日付、合計金額、商品明細リスト（商品名、数量、単価、金額、カテゴリ、stockType）を抽出するためのStructured Outputスキーマ。

```json
{
  "type": "object",
  "required": ["store", "date", "total", "items"],
  "additionalProperties": false,
  "properties": {
    "store": {
      "type": "string",
      "description": "店舗名"
    },
    "date": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
      "description": "レシート日付 (YYYY-MM-DD形式)"
    },
    "total": {
      "type": "number",
      "minimum": 0,
      "description": "レシート合計金額"
    },
    "items": {
      "type": "array",
      "minItems": 1,
      "description": "購入商品明細リスト",
      "items": {
        "type": "object",
        "required": ["name", "quantity", "unitPrice", "amount", "category", "stockType"],
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string",
            "description": "商品名"
          },
          "quantity": {
            "type": "number",
            "minimum": 1,
            "description": "数量"
          },
          "unitPrice": {
            "type": "number",
            "minimum": 0,
            "description": "単価（1個あたりの価格）"
          },
          "amount": {
            "type": "number",
            "minimum": 0,
            "description": "小計・金額"
          },
          "category": {
            "type": "string",
            "enum": ["食費", "日用品", "その他"],
            "description": "支出カテゴリ"
          },
          "stockType": {
            "type": "string",
            "enum": ["ingredient", "daily", "other"],
            "description": "在庫管理区分: ingredient (食材・在庫対象), daily (日用品), other (その他/非在庫対象)"
          }
        }
      }
    }
  }
}
```

---

## 6. 後続タスクでの追加予定

| タスクID | スキーマ名 | 概要 | 状態 |
|---|---|---|---|
| **TASK-002** | `ReceiptOcrSchema` | レシート画像からの店舗名、日付、品目、金額、カテゴリ、stockType等の抽出 | **確定済み (TASK-002)** |
| **TASK-007** | `RecipeSuggestionSchema` | 在庫食材と条件に基づく主菜・副菜・汁物・不足食材の献立提案 | 未着手 (TASK-007で確定) |
