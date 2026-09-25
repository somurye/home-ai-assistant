# Home AI Assistant - 開発運用仕様書 (Development Operations Specification)

## 1. 開発基本原則

### 1.1 Git = 開発SSOT (Single Source of Truth)
- すべてのコード、設定、ドキュメントの正本はGitリポジトリ（ローカルおよびリモート）に存在する。
- GAS IDE（ブラウザ上のスクリプトエディタ）は**実行環境**であり、開発環境ではない。
- **GAS IDE上での直接編集は原則禁止**とする。

### 1.2 変更の局所性とスコープ管理
- 実装タスク指示書（TASK-ID）に定められたスコープ外の変更を禁止する。
- 「将来便利そう」「ついでに修正」といった理由での先行実装や未依頼の広範なリファクタリングは厳禁とする。
- 仕様にない変更が必要となった場合は、作業を中断し、問題点・原因・影響範囲・修正案をPMに報告して指示を仰ぐ。

---

## 2. ディレクトリ構成と役割

```text
home-ai-assistant/
├─ README.md              # プロジェクト概要・基盤説明
├─ Gemini.md              # 実装ガイドライン
├─ Qwen_REVIEW.md         # コードレビュー記録・チェックリスト
├─ docs/                  # 仕様書・運用ドキュメント
│  ├─ SPEC.md             # システム仕様書
│  ├─ DEVELOPMENT.md      # 開発運用仕様書（本ドキュメント）
│  ├─ GAS_MANUAL_DEPLOY.md# GAS手動デプロイ・clasp運用マニュアル
│  └─ GAS_TEST_PLAN.md    # GAS実機テスト計画書
├─ src/                   # GASサーバーサイドコード
│  └─ Code.js             # GASエントリーポイント・接続確認用最小コード
├─ web/                   # フロントエンド資産（HTML/CSS/JS）※TASK-003以降
├─ tests/                 # テストコード
├─ appsscript.json        # GASマニフェストファイル
├─ .clasp.json            # clasp接続設定
├─ .claspignore           # clasp同期除外設定
└─ .gitignore             # Git除外設定
```

---

## 3. 開発運用ライフサイクル

各タスクの開発は、以下の厳格なフェーズを経て進行する。

```text
[タスク着手]
   ↓
1. 実装・検証（ローカル）
   ↓
2. Code Complete（実装完了条件の充足確認）
   ↓
3. Qwen Review（コード・制約監査）
   ↓
4. PM Review（要件・品質確認）
   ↓
5. PM Approved（承認）
   ↓
6. git commit（Gitへのコミット）
   ↓
7. clasp push（GASへの同期）
   ↓
8. GAS Test（実機検証）
   ↓
9. Test Report（検証報告書作成）
   ↓
[Task Complete]
```

---

## 4. clasp 同期運用ルール

1. **同期の方向性**
   - 常に `Git（ローカル） → GAS` の一方向同期とする。
   - コマンド: `clasp push`
2. **プッシュ前の確認**
   - `clasp status` を実行し、同期対象ファイルと除外ファイルが意図通りであることを確認する。
   - `docs/` や `tests/`、`.git/` などがプッシュ対象に含まれていないことを確認する。
3. **GAS側直接変更時の還流ルール**
   - 原則禁止であるが、万が一緊急でGAS IDE上で修正が行われた場合、直ちに `clasp pull` でGitを上書きしてはならない。
   - 一時ディレクトリまたは退避ブランチにて差分を確認し、PM承認を経てGitへ手動マージする。
   - 詳細は `docs/GAS_MANUAL_DEPLOY.md` を参照のこと。

---

## 5. 秘密情報と環境依存値の取り扱い

- **Gitリポジトリへの秘密情報コミット禁止**:
  - APIキー、トークン、機密スプレッドシートID等はリポジトリ内に直接記述しない。
- **PropertiesServiceの利用**:
  - スクリプト実行に必要な秘密情報やIDは、GASの「プロジェクトの設定」>「スクリプト プロパティ」に手動設定し、コード内からは `PropertiesService.getScriptProperties().getProperty('KEY')` 経由で取得する。
