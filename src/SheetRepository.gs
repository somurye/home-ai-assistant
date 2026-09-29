/**
 * @file SheetRepository.gs
 * @description Google Spreadsheet アクセス共通基盤リポジトリ
 * TASK-004: Spreadsheetへのバッチ読み書き、シート取得・初期化、ヘッダー整合性管理を集約する。
 * ループ内での getValue / setValue / appendRow を禁止し、getValues / setValues によるバッチ処理を徹底する。
 */

/**
 * シート名定数定義 (SSOT: docs/DATA_MODEL.md)
 */
var SHEET_NAMES = {
  EXPENSES: '支出明細',
  INVENTORY: '在庫一覧',
  INVENTORY_HISTORY: '在庫履歴',
  SHOPPING_LIST: '買い物リスト',
  MENU_HISTORY: '献立履歴'
};

/**
 * 支出明細シートのヘッダー定義 (SSOT: docs/DATA_MODEL.md)
 */
var EXPENSE_HEADERS = [
  'expense_id',
  '日付',
  '店舗名',
  '商品名',
  'カテゴリ',
  '数量',
  '単価',
  '金額',
  'receipt_drive_id'
];

/**
 * PropertiesServiceから安全にSpreadsheet IDを取得する
 * @param {Object} [options] 
 * @returns {string|null}
 */
function getSpreadsheetId_(options) {
  if (options && options.spreadsheetId) {
    return options.spreadsheetId;
  }
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var props = PropertiesService.getScriptProperties();
      var id = props.getProperty('SPREADSHEET_ID');
      return id ? id.trim() : null;
    }
  } catch (e) {
    // 例外時は安全にnull返却
  }
  return null;
}

/**
 * 対象のSpreadsheetオブジェクトを取得する
 * @param {Object} [options]
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_(options) {
  options = options || {};
  if (options.spreadsheet) {
    return options.spreadsheet;
  }

  var spreadsheetId = getSpreadsheetId_(options);
  if (!spreadsheetId) {
    // コンテナバインド環境のフォールバック
    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
      var active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) return active;
    }
    throw new Error('Spreadsheet ID is not configured in Script Properties (SPREADSHEET_ID).');
  }

  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.openById) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  throw new Error('SpreadsheetApp is not available in the current execution environment.');
}

/**
 * 指定名称のシートを取得する（存在しない場合は初期化して作成する）
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} sheetName
 * @param {Array<string>} headers
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet_(spreadsheet, sheetName, headers) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  } else {
    // 既存シートの場合、ヘッダーが未設定（空）ならヘッダーを書き込む
    if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

/**
 * 「支出明細」シートを取得する（未存在時はヘッダー付きで初期化）
 * @param {Object} [options]
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getExpenseSheet(options) {
  options = options || {};
  var ss = getSpreadsheet_(options);
  return getOrCreateSheet_(ss, SHEET_NAMES.EXPENSES, EXPENSE_HEADERS);
}

/**
 * 支出明細レコード群をバッチで一括追加する (TASK-004)
 * ループ内での逐次書き込みを一切行わず、setValues() による1回の一括挿入を実行する。
 *
 * @param {Array<Array<*>>} rows 登録対象の行データ配列（ヘッダー順の2次元配列）
 * @param {Object} [options] 実行オプション（モック・ID指定等）
 * @returns {{ok: true, insertedCount: number, startRow: number}|{ok: false, error: {type: string, message: string}}}
 */
function appendExpenseRows(rows, options) {
  options = options || {};

  // 1. 引数検証
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error('[appendExpenseRows] rows must be a non-empty array of row arrays.');
    return {
      ok: false,
      error: {
        type: 'INVALID_ARGUMENT',
        message: '入力データが不正です。'
      }
    };
  }

  var numCols = EXPENSE_HEADERS.length;
  for (var i = 0; i < rows.length; i++) {
    if (!Array.isArray(rows[i]) || rows[i].length !== numCols) {
      console.error('[appendExpenseRows] Row at index ' + i + ' must have exactly ' + numCols + ' columns.');
      return {
        ok: false,
        error: {
          type: 'INVALID_ARGUMENT',
          message: '入力データが不正です。'
        }
      };
    }
  }

  // 2. 排他制御 (DEC-03)
  var lock = null;
  var hasLock = false;
  if ((options && options.lock) || (typeof LockService !== 'undefined' && LockService.getScriptLock)) {
    try {
      lock = (options && options.lock) ? options.lock : LockService.getScriptLock();
      if (lock) {
        lock.waitLock(10000); // 10秒待機
        hasLock = true;
      }
    } catch (lockErr) {
      console.error('[appendExpenseRows] Lock acquire failed: ' + (lockErr.message || String(lockErr)));
      return {
        ok: false,
        error: {
          type: 'LOCK_TIMEOUT',
          message: '排他制御のロック取得に失敗しました。時間をおいて再度お試しください。'
        }
      };
    }
  }

  // 3. シート取得およびバッチ書き込み
  try {
    var sheet = getExpenseSheet(options);
    var lastRow = sheet.getLastRow();
    var startRow = lastRow + 1;

    // 日付列 (B列: 列インデックス2) を書式なしテキストとして設定 (DEC-04)
    sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('@');

    // バッチ書き込み: setValues で一括登録（ループ内の setValue / appendRow 禁止）
    sheet.getRange(startRow, 1, rows.length, numCols).setValues(rows);

    return {
      ok: true,
      insertedCount: rows.length,
      startRow: startRow
    };
  } catch (err) {
    console.error('[appendExpenseRows] Failed to append expense rows to Spreadsheet: ' + (err.message || String(err)));
    return {
      ok: false,
      error: {
        type: 'REPOSITORY_ERROR',
        message: 'スプレッドシートへの保存処理に失敗しました。'
      }
    };
  } finally {
    if (lock && hasLock) {
      try {
        lock.releaseLock();
      } catch (releaseErr) {
        console.error('[appendExpenseRows] Error releasing lock: ' + (releaseErr.message || String(releaseErr)));
      }
    }
  }
}

/**
 * 「支出明細」シートの全データをバッチで一括取得する (TASK-004)
 * getDataRange().getValues() による一括取得を行い、メモリ上でヘッダーとレコードに分離する。
 *
 * @param {Object} [options]
 * @returns {{ok: true, headers: Array<string>, rows: Array<Array<*>>}|{ok: false, error: {type: string, message: string}}}
 */
function getAllExpenseRows(options) {
  options = options || {};
  try {
    var sheet = getExpenseSheet(options);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      // ヘッダーのみ、または空
      return {
        ok: true,
        headers: EXPENSE_HEADERS.slice(),
        rows: []
      };
    }

    var lastCol = sheet.getLastColumn();
    // バッチ取得: getValues で全行全列を一括読み込み
    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = allValues[0];
    var dataRows = allValues.slice(1);

    return {
      ok: true,
      headers: headers,
      rows: dataRows
    };
  } catch (err) {
    console.error('[getAllExpenseRows] Failed to read expense rows from Spreadsheet: ' + (err.message || String(err)));
    return {
      ok: false,
      error: {
        type: 'REPOSITORY_ERROR',
        message: 'スプレッドシートからのデータ取得に失敗しました。'
      }
    };
  }
}

// Node.js環境でのテスト互換性用エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SHEET_NAMES: SHEET_NAMES,
    EXPENSE_HEADERS: EXPENSE_HEADERS,
    getSpreadsheetId_: getSpreadsheetId_,
    getSpreadsheet_: getSpreadsheet_,
    getOrCreateSheet_: getOrCreateSheet_,
    getExpenseSheet: getExpenseSheet,
    appendExpenseRows: appendExpenseRows,
    getAllExpenseRows: getAllExpenseRows
  };
}
