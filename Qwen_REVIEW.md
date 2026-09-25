# Qwen Review Guidelines & Audit Log (Code Review Role)

本ドキュメントは、プロジェクト「Home AI Assistant」におけるコードレビューおよび制約監査（Qwen Review）の基準と記録を管理する。

## 1. 監査・レビュー観点

| チェック項目 | 監査内容 |
|---|---|
| **制約遵守** | 指示書の「厳守すべきハード制約・禁止事項」に違反していないか |
| **スコープ境界** | 未依頼のファイル・機能・先行実装（OCR, Gemini, DB, UI等）が含まれていないか |
| **Git SSOT** | Gitが唯一の正本として維持されており、GAS直接編集を前提とした構成になっていないか |
| **セキュリティ** | APIキー、トークン、機密ID等のハードコードが存在しないか |
| **整合性** | ドキュメント（SPEC, DEVELOPMENT, DEPLOY, TEST_PLAN）と実装内容に乖離がないか |
| **変更の最小性** | 不要なフォーマット変更や無関係なファイルへの破壊的変更がないか |

---

## 2. レビュー監査記録テンプレート

```markdown
## Task Review: [TASK-ID] [タスク名]
- レビュアー: Qwen
- 実施日: YYYY-MM-DD
- ステータス: [Approved / Changes Requested]

### 1. 判定サマリー
- [Pass / Fail] ハード制約遵守
- [Pass / Fail] スコープ管理（先行実装なし）
- [Pass / Fail] セキュリティ（秘密情報なし）
- [Pass / Fail] Git SSOT原則遵守

### 2. 指摘事項（あれば記載）
1. (ファイル名:行番号): 指摘内容

### 3. 総評
- レビュー総評
```

---

## 3. レビューログ履歴

### Task Review: TASK-000 GAS開発基盤・運用基盤構築
*(レビュー実施後に記録)*
