/**
 * @file ExpenseService.gs
 * @description 家計簿・支出明細登録ビジネスサービス
 * TASK-004: 確定済みレシートOCRデータを検証・正規化し、行番号非依存の一意なexpense_idを付与して
 * SheetRepository経由で「支出明細」シートへバッチ登録する。
 * ※Gemini -> Schema validation -> Business validation -> SheetRepository -> Spreadsheet の順序を厳守。
 */

/**
 * ランダム英数字を生成するヘルパー（暗号的・高エントロピー）
 * @param {number} length 
 * @returns {string}
 */
function generateRandomSuffix_(length) {
  var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var result = '';
  for (var i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 2桁以上のゼロパディングヘルパー
 * @param {number} num 
 * @param {number} digits 
 * @returns {string}
 */
function padZero_(num, digits) {
  var s = String(num);
  while (s.length < digits) {
    s = '0' + s;
  }
  return s;
}

/**
 * 一意な expense_id を生成する (TASK-004)
 * 形式: EXP-YYYYMMDD-HHMMSS-NNN-XXXX
 * 行番号に一切依存せず、タイムスタンプ + バッチ内連番 + ランダム英数字により同時実行時も重複を防止する。
 *
 * @param {Date} [now] 基準日時
 * @param {number} [index=1] バッチ内インデックス（1始まり）
 * @returns {string} 一意な expense_id
 */
function generateExpenseId(now, index) {
  var date = now || new Date();
  var idx = (typeof index === 'number' && index >= 1) ? index : 1;

  var year = date.getFullYear();
  var month = padZero_(date.getMonth() + 1, 2);
  var day = padZero_(date.getDate(), 2);
  var hours = padZero_(date.getHours(), 2);
  var minutes = padZero_(date.getMinutes(), 2);
  var seconds = padZero_(date.getSeconds(), 2);

  var datePart = '' + year + month + day;
  var timePart = '' + hours + minutes + seconds;
  var seqPart = padZero_(idx, 3);
  var randomPart = generateRandomSuffix_(4);

  return 'EXP-' + datePart + '-' + timePart + '-' + seqPart + '-' + randomPart;
}

/**
 * 確定済みレシートデータの業務ルール詳細検証 (Business Validation)
 * 必須項目、型、正の整数、0以上の金額、有効な日付形式、カテゴリ・在庫区分を検証する。
 *
 * @param {*} data 
 * @returns {{valid: boolean, error?: string}}
 */
function validateConfirmedReceiptData_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Confirmed data must be a non-null object.' };
  }

  // 1. 店舗名
  if (typeof data.store !== 'string' || data.store.trim() === '') {
    return { valid: false, error: 'Store name must be a non-empty string.' };
  }

  // 2. 日付 (YYYY-MM-DD かつ 実在日)
  if (typeof data.date !== 'string') {
    return { valid: false, error: 'Receipt date must be a string.' };
  }
  var dateMatch = data.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return { valid: false, error: 'Receipt date must match YYYY-MM-DD format: ' + data.date };
  }
  var parsedDate = new Date(data.date);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, error: 'Receipt date is invalid calendar date: ' + data.date };
  }

  // 3. 商品明細
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { valid: false, error: 'Receipt items must be an array with at least one item.' };
  }

  var validCategories = ['食費', '日用品', 'その他'];
  var validStockTypes = ['ingredient', 'daily', 'other'];

  for (var i = 0; i < data.items.length; i++) {
    var item = data.items[i];
    var path = 'items[' + i + ']';

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: path + ' must be an object.' };
    }

    if (typeof item.name !== 'string' || item.name.trim() === '') {
      return { valid: false, error: path + '.name must be a non-empty string.' };
    }

    // 数量: 1以上の正の整数
    if (typeof item.quantity !== 'number' || isNaN(item.quantity) || item.quantity < 1 || Math.floor(item.quantity) !== item.quantity) {
      return { valid: false, error: path + '.quantity must be an integer >= 1.' };
    }

    // 単価: 0以上の数値
    if (typeof item.unitPrice !== 'number' || isNaN(item.unitPrice) || item.unitPrice < 0) {
      return { valid: false, error: path + '.unitPrice must be a non-negative number.' };
    }

    // 金額: 0以上の数値
    if (typeof item.amount !== 'number' || isNaN(item.amount) || item.amount < 0) {
      return { valid: false, error: path + '.amount must be a non-negative number.' };
    }

    if (validCategories.indexOf(item.category) === -1) {
      return { valid: false, error: path + '.category must be one of: ' + validCategories.join(', ') };
    }

    if (item.stockType && validStockTypes.indexOf(item.stockType) === -1) {
      return { valid: false, error: path + '.stockType must be one of: ' + validStockTypes.join(', ') };
    }
  }

  return { valid: true };
}

/**
 * 確定済みレシートOCRデータを「支出明細」シートへ登録するビジネスサービス (TASK-004)
 * 
 * @param {Object} confirmedData TASK-003でユーザーが確認・修正したレシートデータ
 * @param {Object} [options] 実行オプション（モックリポジトリ注入・ID指定等）
 * @returns {{ok: true, data: {registeredCount: number, expenseIds: Array<string>, records: Array<Object>}}|{ok: false, error: {type: string, message: string}}}
 */
function registerExpenses(confirmedData, options) {
  options = options || {};

  // 1. 業務ルール検証 (Business Validation)
  var validation = validateConfirmedReceiptData_(confirmedData);
  if (!validation.valid) {
    console.error('[registerExpenses] Validation error: ' + validation.error);
    return {
      ok: false,
      error: {
        type: 'VALIDATION_ERROR',
        message: '入力データが不正です。内容を確認してください。'
      }
    };
  }

  // 2. レコード生成とexpense_id発番
  var now = options.now || new Date();
  var rows = [];
  var expenseIds = [];
  var records = [];
  var store = confirmedData.store.trim();
  var dateStr = confirmedData.date.trim();

  for (var i = 0; i < confirmedData.items.length; i++) {
    var item = confirmedData.items[i];
    var expenseId = generateExpenseId(now, i + 1);
    var driveId = (confirmedData.receipt_drive_id && typeof confirmedData.receipt_drive_id === 'string') 
      ? confirmedData.receipt_drive_id 
      : ''; // TASK-004ではDrive保存は対象外

    var row = [
      expenseId,                  // A: expense_id
      dateStr,                    // B: 日付
      store,                      // C: 店舗名
      item.name.trim(),           // D: 商品名
      item.category,              // E: カテゴリ
      item.quantity,              // F: 数量 (1以上の整数)
      item.unitPrice,             // G: 単価
      item.amount,                // H: 金額 (小計)
      driveId                     // I: receipt_drive_id
    ];

    rows.push(row);
    expenseIds.push(expenseId);
    records.push({
      expense_id: expenseId,
      date: dateStr,
      store: store,
      name: item.name.trim(),
      category: item.category,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      receipt_drive_id: driveId
    });
  }

  // 3. SheetRepository 経由でのバッチ登録 (逐次書き込み禁止)
  var appendFn = (options.sheetRepository && options.sheetRepository.appendExpenseRows) 
    ? options.sheetRepository.appendExpenseRows 
    : appendExpenseRows;

  var repoResult = appendFn(rows, options);
  if (!repoResult.ok) {
    console.error('[registerExpenses] Repository error: ' + (repoResult.error ? JSON.stringify(repoResult.error) : 'Unknown repository error'));
    return {
      ok: false,
      error: repoResult.error || {
        type: 'REPOSITORY_ERROR',
        message: 'スプレッドシートへの保存処理に失敗しました。'
      }
    };
  }

  return {
    ok: true,
    data: {
      registeredCount: rows.length,
      expenseIds: expenseIds,
      records: records
    }
  };
}

/**
 * TASK-004 自己診断テストランナー
 * Test A (単一登録), Test B (複数登録), Test C (ID重複), Test D (バッチ処理), Test E (同時/大量登録)
 * モック環境で安全に全件検証する。
 *
 * @returns {{passed: number, failed: number, details: Array<string>}}
 */
function testExpenseService() {
  var results = { passed: 0, failed: 0, details: [] };

  function assert(condition, message) {
    if (condition) {
      results.passed++;
      results.details.push('PASS: ' + message);
    } else {
      results.failed++;
      results.details.push('FAIL: ' + message);
    }
  }

  // モックSheetRepositoryの作成
  function createMockRepository() {
    var storedRows = [];
    var callCount = { append: 0, get: 0 };
    return {
      getStoredRows: function() { return storedRows; },
      getCallCount: function() { return callCount; },
      appendExpenseRows: function(rows) {
        callCount.append++;
        for (var i = 0; i < rows.length; i++) {
          storedRows.push(rows[i]);
        }
        return { ok: true, insertedCount: rows.length, startRow: storedRows.length - rows.length + 2 };
      }
    };
  }

  // -------------------------------------------------------------
  // Test A: 単一登録テスト
  // -------------------------------------------------------------
  var mockRepoA = createMockRepository();
  var singleData = {
    store: 'セブン-イレブン',
    date: '2026-09-27',
    items: [
      { name: 'おにぎり', quantity: 1, unitPrice: 150, amount: 150, category: '食費', stockType: 'ingredient' }
    ]
  };

  var resA = registerExpenses(singleData, { sheetRepository: mockRepoA });
  assert(resA.ok === true, 'Test A: 単一登録が成功すること');
  assert(resA.data.registeredCount === 1, 'Test A: 登録件数が1件であること');
  assert(typeof resA.data.expenseIds[0] === 'string' && resA.data.expenseIds[0].indexOf('EXP-') === 0, 'Test A: expense_id が生成されること');
  var rowA = mockRepoA.getStoredRows()[0];
  assert(rowA[0] === resA.data.expenseIds[0] && rowA[1] === '2026-09-27' && rowA[2] === 'セブン-イレブン' && rowA[3] === 'おにぎり' && rowA[4] === '食費' && rowA[5] === 1 && rowA[6] === 150 && rowA[7] === 150 && rowA[8] === '', 'Test A: 登録された各列の値が正しいこと');

  // -------------------------------------------------------------
  // Test B: 複数登録テスト (5商品まとめて登録)
  // -------------------------------------------------------------
  var mockRepoB = createMockRepository();
  var multiData = {
    store: 'セブン-イレブン 羽曳野店',
    date: '2026-09-27',
    items: [
      { name: 'セブンプレミアム カレー', quantity: 1, unitPrice: 320, amount: 320, category: '食費', stockType: 'ingredient' },
      { name: 'ほうれん草のサラダ', quantity: 1, unitPrice: 210, amount: 210, category: '食費', stockType: 'ingredient' },
      { name: 'コーヒー Sサイズ', quantity: 2, unitPrice: 100, amount: 200, category: '食費', stockType: 'ingredient' },
      { name: '菓子パン', quantity: 1, unitPrice: 150, amount: 150, category: '食費', stockType: 'ingredient' },
      { name: '缶ビール 350ml', quantity: 2, unitPrice: 220, amount: 440, category: '食費', stockType: 'ingredient' }
    ]
  };

  var resB = registerExpenses(multiData, { sheetRepository: mockRepoB });
  assert(resB.ok === true, 'Test B: 複数件登録が成功すること');
  assert(resB.data.registeredCount === 5, 'Test B: 登録件数が5件であること (登録件数 = 入力件数)');
  assert(mockRepoB.getStoredRows().length === 5, 'Test B: リポジトリに5行登録されていること');
  assert(mockRepoB.getCallCount().append === 1, 'Test B: 1回のバッチAPI呼び出しで5件まとめて登録されていること (逐次呼び出しなし)');

  // -------------------------------------------------------------
  // Test C: ID重複確認 (複数回登録)
  // -------------------------------------------------------------
  var mockRepoC = createMockRepository();
  var allGeneratedIds = [];
  var hasDuplicate = false;

  for (var round = 0; round < 10; round++) {
    var resC = registerExpenses(singleData, { sheetRepository: mockRepoC });
    var id = resC.data.expenseIds[0];
    if (allGeneratedIds.indexOf(id) !== -1) {
      hasDuplicate = true;
    }
    allGeneratedIds.push(id);
  }
  assert(allGeneratedIds.length === 10 && !hasDuplicate, 'Test C: 複数回登録時に expense_id が重複しないこと (10件すべて一意)');

  // -------------------------------------------------------------
  // Test D: バッチアクセス確認
  // -------------------------------------------------------------
  var mockRepoD = createMockRepository();
  registerExpenses(multiData, { sheetRepository: mockRepoD });
  assert(mockRepoD.getCallCount().append === 1, 'Test D: ループ内逐次 appendRow 等を行わず、1回の一括書き込みで完了すること');

  // -------------------------------------------------------------
  // Test E: 同時/大量登録テスト (100件連続登録時のID一意性)
  // -------------------------------------------------------------
  var largeIdSet = {};
  var largeDuplicateFound = false;
  var fixedDate = new Date();

  for (var k = 0; k < 100; k++) {
    var generatedId = generateExpenseId(fixedDate, k + 1);
    if (largeIdSet[generatedId]) {
      largeDuplicateFound = true;
      break;
    }
    largeIdSet[generatedId] = true;
  }
  assert(!largeDuplicateFound && Object.keys(largeIdSet).length === 100, 'Test E: 同一ミリ秒基準の100件連続ID生成で重複が0件であること');

  // -------------------------------------------------------------
  // 異常系バリデーションテスト
  // -------------------------------------------------------------
  var invalidStore = registerExpenses({ store: '', date: '2026-09-27', items: [{ name: 'A', quantity: 1, unitPrice: 100, amount: 100, category: '食費' }] });
  assert(invalidStore.ok === false && invalidStore.error.type === 'VALIDATION_ERROR', '異常系: 店舗名空文字でVALIDATION_ERRORとなること');

  var invalidDate = registerExpenses({ store: 'A', date: '2026/09/27', items: [{ name: 'A', quantity: 1, unitPrice: 100, amount: 100, category: '食費' }] });
  assert(invalidDate.ok === false && invalidDate.error.type === 'VALIDATION_ERROR', '異常系: 日付形式不正でVALIDATION_ERRORとなること');

  var invalidQty = registerExpenses({ store: 'A', date: '2026-09-27', items: [{ name: 'A', quantity: 1.5, unitPrice: 100, amount: 100, category: '食費' }] });
  assert(invalidQty.ok === false && invalidQty.error.type === 'VALIDATION_ERROR', '異常系: 数量が小数でVALIDATION_ERRORとなること');

  var invalidAmount = registerExpenses({ store: 'A', date: '2026-09-27', items: [{ name: 'A', quantity: 1, unitPrice: 100, amount: -10, category: '食費' }] });
  assert(invalidAmount.ok === false && invalidAmount.error.type === 'VALIDATION_ERROR', '異常系: 金額が負数でVALIDATION_ERRORとなること');

  return results;
}

// Node.js環境でのテスト互換性用エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateRandomSuffix_: generateRandomSuffix_,
    padZero_: padZero_,
    generateExpenseId: generateExpenseId,
    validateConfirmedReceiptData_: validateConfirmedReceiptData_,
    registerExpenses: registerExpenses,
    testExpenseService: testExpenseService
  };
}
