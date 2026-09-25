# GAS 実機テスト計画書 (GAS Test Plan)

## 1. 目的

本書は、Google Apps Script (GAS) 実行環境における動作確認および、GitからGASへの同期状態を客観的・再現可能な方法で検証するためのテスト計画を定める。

本タスク（TASK-000）においては、**開発基盤・運用基盤が正しく機能していることのみ**を検証対象とし、アプリケーション業務機能（レシートOCR、Gemini API、DB CRUD、UI等）のテストは行わない。

---

## 2. テストスコープ

* 対象:
  * clasp による Git → GAS 同期機能
  * GAS 上での最小関数の実行可能性（`testConnection`）
  * GAS Web App としての最小レスポンス（`doGet`）
* 対象外:
  * アプリケーション業務ロジック全般
  * 外部サービス（Gemini API, Google Drive, Google Sheets）とのデータ送受信

---

## 3. テストケース定義

| テストID | テスト項目 | 検証手順 | 期待される結果 |
|---|---|---|---|
| **T000-01** | clasp環境確認 | `clasp --version` を実行する | claspのバージョン情報が出力されること |
| **T000-02** | clasp接続確認 | `clasp status` を実行する | `.clasp.json` の設定に従い、同期対象ファイルと除外ファイルが正しく認識されること |
| **T000-03** | Git → GAS同期確認 | `clasp push` を実行する | エラーなく正常に完了し、ファイルがGASへ転送されること |
| **T000-04** | GAS同期整合性確認 | GAS側のファイル内容がローカルGitのコードと一致していることを確認する | コードの差分が存在しないこと |
| **T000-05** | GAS Web App起動確認 | ブラウザからWeb App公開URL（またはテスト用URL）にアクセスする | `<h1>Home AI Assistant</h1><p>TASK-000: GAS connection OK</p>` 等の最小HTMLが正常に表示されること |
| **T000-06** | 最小GAS関数実行確認 | GAS IDE の実行ボタンまたは `testConnection()` を呼び出す | 実行ログに `'TASK-000: GAS connection test'` が出力され、返り値 `'OK'` で終了すること |

---

## 4. 実機確認方法

### 4.1 Web App 接続確認
1. GASエディタまたは `clasp deployments` でデプロイURLを取得する。
2. WebブラウザでデプロイURLを開く。
3. 接続確認用の最小HTMLが表示されることを確認する。

### 4.2 サーバーサイド関数実行確認
1. GASエディタ（`https://script.google.com/d/<SCRIPT_ID>/edit`）を開く。
2. 上部ツールバーの関数選択ドロップダウンから `testConnection` を選択する。
3. 「実行」ボタンを押下する。
4. 実行ログ（Execution log）に以下のような出力が記録されることを確認する：
   ```text
   TASK-000: GAS connection test - YYYY-MM-DDTHH:mm:ss.sssZ
   TASK-000: Script ID confirmed via clasp push
   ```

---

## 5. テスト結果の記録方法

各タスクの実装報告または検証報告において、以下のフォーマットでテスト結果を記録する。

```markdown
### GAS Test Execution Report

- 実施日時: YYYY-MM-DD HH:mm:ss
- 実施環境: Windows (Local), Google Apps Script (Remote V8)
- スクリプトID: <SCRIPT_ID>

| テストID | テスト項目 | 結果 (Pass/Fail) | エビデンス・備考 |
|---|---|---|---|
| T000-01 | clasp環境確認 | Pass | バージョン出力確認 |
| T000-02 | clasp接続確認 | Pass | clasp status 正常出力 |
| T000-03 | Git → GAS同期確認 | Pass | clasp push 正常終了 |
| T000-04 | GAS同期整合性確認 | Pass | ファイル差分なし |
| T000-05 | GAS Web App起動確認 | Pass | HTTP 200 / 最小HTMLレスポンス確認 |
| T000-06 | 最小GAS関数実行確認 | Pass | testConnection 実行ログ確認 |
```
