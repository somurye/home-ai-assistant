/**
 * Home AI Assistant
 * Google統合型 家計・在庫・献立アシスタント
 *
 * TASK-000: 開発基盤構築 - GAS接続確認用最小実装
 *
 * 注意: このファイルはGAS接続確認のみを目的とする。
 * アプリケーション業務ロジック（OCR、Gemini、Spreadsheet CRUD等）はTASK-001以降で実装する。
 */

// ---------------------------------------------------------------------------
// GAS Web App エントリーポイント
// ---------------------------------------------------------------------------

/**
 * HTTP GET リクエストのエントリーポイント。
 * TASK-000では開発基盤の疎通確認のみを行う最小レスポンスを返す。
 *
 * @return {GoogleAppsScript.HTML.HtmlOutput} GAS HTML Service レスポンス
 */
function doGet() {
  return HtmlService.createHtmlOutput('<h1>Home AI Assistant</h1><p>TASK-000: GAS connection OK</p>');
}

// ---------------------------------------------------------------------------
// 開発基盤確認用テスト関数
// ---------------------------------------------------------------------------

/**
 * GAS接続確認テスト関数。
 * GAS IDE の「実行」または clasp 経由で呼び出す。
 * T000-06: 最小GAS関数実行の確認に使用する。
 *
 * @return {string} 'OK' (正常時)
 */
function testConnection() {
  Logger.log('TASK-000: GAS connection test - ' + new Date().toISOString());
  Logger.log('TASK-000: Script ID confirmed via clasp push');
  return 'OK';
}
