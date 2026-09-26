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
 * レシート撮影・画像最適化・送信UI (web/index.html) を返す。
 *
 * @return {GoogleAppsScript.HTML.HtmlOutput} GAS HTML Service レスポンス
 */
function doGet() {
  return HtmlService.createTemplateFromFile('web/index')
    .evaluate()
    .setTitle('Home AI Assistant - レシートOCR')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * HTMLファイルまたはスクリプトをインクルードするテンプレートヘルパー関数。
 *
 * @param {string} filename インクルード対象ファイル名 (例: 'web/app')
 * @return {string} ファイルの内容 (HTML/JS)
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------------------------------------------------------------------------
// レシートOCR エントリーポイント (TASK-002)
// ---------------------------------------------------------------------------

/**
 * クライアント（ブラウザ）から最適化されたレシート画像を受け取り、
 * ReceiptService経由でGemini Multimodal OCRを実行して検証済み構造化データを返す。
 * ※本タスクではSpreadsheetへの保存は行わない（TASK-004で実装）。
 *
 * @param {string} base64Image 最適化されたレシート画像のBase64データ
 * @return {Object} OCR結果オブジェクト {ok: boolean, data?: Object, error?: Object}
 */
function receiveReceiptImage(base64Image) {
  console.log('[receiveReceiptImage] Invoked. Image string length: ' + (base64Image ? base64Image.length : 0));
  var result = processReceiptImage(base64Image);
  console.log('[receiveReceiptImage] Result: ok=' + result.ok + (result.ok ? ', store=' + (result.data && result.data.store) : ', error=' + JSON.stringify(result.error)));
  return result;
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
