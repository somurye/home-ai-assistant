# GAS デプロイ・clasp運用マニュアル (GAS Manual Deploy & Clasp Operations)

## 1. 概要

本書は、ローカルGitリポジトリを唯一のSSOT（Single Source of Truth）として維持しながら、Google Apps Script (GAS) 環境へコードを安全に反映・デプロイするための手順書である。

---

## 2. 前提条件と認証

### 2.1 clasp のインストール
`@google/clasp` がシステムにグローバルまたはローカルにインストールされていること。

```bash
clasp --version
# 推奨バージョン: 2.4.x 以上（現行: 3.4.1）
```

### 2.2 Googleアカウントの認証
Googleアカウントとの連携を行う。

```bash
clasp login
```
* ブラウザが起動し、Google Apps Script API へのアクセス権限が要求される。
* 認証が完了すると、ホームディレクトリ（`~/.clasprc.json`）にOAuth認証トークンが安全に保存される。
* **注意**: `~/.clasprc.json` をリポジトリ内に移動・コピーしたりコミットしてはならない。

### 2.3 Google Apps Script APIの有効化
対象Googleアカウントの「Google Apps Scriptの設定」（https://script.google.com/home/usersettings）にて、「Google Apps Script API」が**オン**になっていることを確認する。

---

## 3. 対象GASプロジェクトとの接続設定

### 3.1 .clasp.json の構成
リポジトリ直下の `.clasp.json` に対象スクリプトIDを指定する。

```json
{
  "scriptId": "1YHmxUWYaolFA9QYTt-Zy3Eo4tlJ3iADCTc-CuraSIwNte9L0FLcP41z_",
  "rootDir": ""
}
```

* `scriptId`: 対象GASプロジェクトのスクリプトID（GASエディタのURL `https://script.google.com/d/<SCRIPT_ID>/edit` から取得可能）。
* `rootDir`: ルートまたはソースディレクトリのパス（空文字列 `""` はプロジェクトルートを指す）。

---

## 4. Git → GAS 同期手順

### 4.1 同期前の確認（事前チェック）
プッシュ前に、同期対象ファイルと除外ファイルが正しいか確認する。

```bash
clasp status
```
* `src/` 配下のスクリプト、`web/` 配下のHTML、`appsscript.json` のみが対象に含まれていること。
* `docs/`、`tests/`、`README.md`、`.git/` などが含まれていないこと（`.claspignore` により除外されていること）。

### 4.2 GASへのプッシュ（同期実行）
PM承認およびコミット完了後、以下のコマンドでGASへコードを転送する。

```bash
clasp push
```
* GAS上の既存ファイルがGit側の最新状態で上書き同期される。

---

## 5. Web Appとしてのデプロイ手順

### 5.1 バージョンの作成とデプロイ
GAS Web Appとして外部公開または更新する場合、`clasp deploy` を実行する。

```bash
# 新規バージョン作成とデプロイ
clasp deploy --description "TASK-000: Initial development setup"

# 既存デプロイ一覧の確認
clasp deployments
```

### 5.2 GAS Web App のアクセス設定（GAS IDE確認）
必要に応じてGAS IDE（ブラウザ）上で以下の設定を確認する：
* **次のユーザーとして実行**: 自分（アクセス権限を持つアカウント）
* **アクセスできるユーザー**: 全員（または組織内のユーザー）

---

## 6. GAS IDE 直接編集禁止の厳守

* **原則**: ブラウザ上のGAS IDE上でコードを変更してはならない。
* **理由**: GAS IDE上でコードを変更すると、Git上の変更履歴と乖離（ドリフト）が発生し、次回 `clasp push` 時に意図せず消去されたり、コンフリクトの原因となるため。

---

## 7. 緊急時：GAS側を直接変更した場合のGit還流手順

本番障害対応等により、やむを得ずGAS IDE上でコードを直接修正した場合の例外的な還流手順：

1. **直接 `clasp pull` を実行しないこと！**
   Git作業ツリーが破壊されるのを防ぐため、メインの作業ブランチで即座にpullしてはならない。
2. **一時ディレクトリ（または別ブランチ）への退避**:
   ```bash
   # 例: 一時作業用ブランチを作成
   git checkout -b temp/gas-hotfix-sync
   
   # GAS側の最新コードを取得
   clasp pull
   ```
3. **差分の確認と検証**:
   ```bash
   git diff main temp/gas-hotfix-sync
   ```
4. **PM承認とGitへのマージ**:
   * 変更理由、差分内容をPMに報告。
   * 承認を得た上で、変更内容を正式にコミットし、`main` ブランチへマージする。
5. **SSOTの再確立**:
   * マージ後、改めて `clasp push` を行い、GitとGASが完全に一致していることを確認する。
