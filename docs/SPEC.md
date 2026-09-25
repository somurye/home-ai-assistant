# Home AI Assistant - システム仕様書 (System Specification)

## 1. プロジェクト概要

「Home AI Assistant」（Google統合型 家計・在庫・献立アシスタント）は、Google Apps Script (GAS) を実行環境とし、Google スプレッドシート、Google ドライブ、Google Gemini API と連携して家庭内の家計・食材在庫・献立提案を一元管理する統合アシスタントシステムである。

本ドキュメントはシステムの全体方針および開発基盤の仕様を定義する。

---

## 2. 開発・運用アーキテクチャ方針

### 2.1 Git唯一のSSOT（Single Source of Truth）原則
* **Gitリポジトリを開発の唯一の正本（SSOT）とする。**
* すべての仕様策定、コード実装、テスト設計、レビュー、変更履歴管理はGit上で行う。
* Google Apps Script (GAS) IDE 上での直接コード編集は**厳禁**とする。
* GAS IDE上のコードを開発の正本として扱ってはならない。

### 2.2 実行環境と同期方針
* GASはあくまで「実行・検証環境」として位置付ける。
* ローカル（Git）からGAS環境への反映は、公式CLIツールである `clasp`（`clasp push`）を用いて一方向（Git → GAS）に行う。
* 通常の開発フローにおいて GAS → Git の逆方向同期（`clasp pull`）は行わない。万が一GAS側で緊急変更が行われた場合は、`docs/GAS_MANUAL_DEPLOY.md` に定める「GAS側直接変更時のGit還流手順」に従い、厳密な差分確認とPM承認を経てGitへ反映する。

---

## 3. タスク分割とスコープ管理

本プロジェクトは段階的タスク管理（TASK-XXX）により進行する。

* **TASK-000: GAS開発基盤・運用基盤構築（本タスク）**
  * Gitプロジェクト基本構成の整備
  * 基本ドキュメント群の配置
  * `clasp` 環境構築およびGAS接続
  * Git → GAS同期フローの確立
  * GAS IDE直接編集禁止ルールの明文化
  * 実機検証計画・手順の定義
  * **注記**: アプリケーション機能（レシートOCR、Gemini API、DB CRUD、在庫・献立ロジック、フロントエンドUI）は一切実装しない。
* **TASK-001以降**:
  * Gemini Structured Output / OCR連携
  * Google Spreadsheet データモデル実装
  * フロントエンドUI (HTML/CSS/JS) 実装
  * 在庫・献立ロジック実装

---

## 4. セキュリティおよび秘密情報管理原則

1. **認証情報のGitコミット禁止**
   * GCP/Gemini APIキー、OAuthクライアント情報、秘密トークンをGitリポジトリ内に平文またはソースコードとして記録することを禁止する。
2. **環境依存値の管理**
   * スプレッドシートID、フォルダID、外部APIキー等の環境依存値および機密値は、GASの `PropertiesService.getScriptProperties()` を利用して実行環境側で管理する。
3. **同期ファイルの限定**
   * `.claspignore` を厳密に設定し、ドキュメント・テスト・Git管理ファイルがGASへ同期されないようにする。
