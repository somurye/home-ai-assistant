/**
 * @file ReceiptService.gs
 * @description レシートOCR処理サービス
 * TASK-002: Base64レシート画像からGemini Multimodal Structured Outputを呼び出し、構造化データを検証・抽出する。
 * ※本タスクではSpreadsheetへの保存は行わない（TASK-004で実装）。
 */

/**
 * レシートOCR Structured Output スキーマ定義
 * docs/GEMINI_SCHEMA.md 準拠 (SSOT)
 */
var RECEIPT_OCR_SCHEMA = {
  type: 'object',
  required: ['store', 'date', 'total', 'items'],
  additionalProperties: false,
  properties: {
    store: {
      type: 'string',
      description: '店舗名'
    },
    date: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'レシート日付 (YYYY-MM-DD形式)'
    },
    total: {
      type: 'number',
      minimum: 0,
      description: 'レシート合計金額'
    },
    items: {
      type: 'array',
      minItems: 1,
      description: '購入商品明細リスト',
      items: {
        type: 'object',
        required: ['name', 'quantity', 'unitPrice', 'amount', 'category', 'stockType'],
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            description: '商品名'
          },
          quantity: {
            type: 'number',
            minimum: 1,
            description: '数量'
          },
          unitPrice: {
            type: 'number',
            minimum: 0,
            description: '単価（1個あたりの価格）'
          },
          amount: {
            type: 'number',
            minimum: 0,
            description: '小計・金額'
          },
          category: {
            type: 'string',
            enum: ['食費', '日用品', 'その他'],
            description: '支出カテゴリ'
          },
          stockType: {
            type: 'string',
            enum: ['ingredient', 'daily', 'other'],
            description: '在庫管理区分: ingredient (食材・在庫対象), daily (日用品), other (その他/非在庫対象)'
          }
        }
      }
    }
  }
};

/**
 * レシートOCR用Gemini指示プロンプト
 */
var RECEIPT_OCR_PROMPT = 
  '添付されたレシート画像を詳細に読み取り、店舗名、購入日付(YYYY-MM-DD)、合計金額、' +
  'および購入した各商品の明細(商品名、数量、単価、金額、支出カテゴリ、在庫管理区分stockType)をJSON形式で抽出してください。\n' +
  '- 店舗名はチェーン名や店名を正確に抽出してください。\n' +
  '- 日付はレシート記載の購入日を西暦YYYY-MM-DD形式に変換してください。\n' +
  '- 支出カテゴリは「食費」「日用品」「その他」のいずれかに分類してください。\n' +
  '- stockTypeは食材・食品・調味料等の在庫管理対象であれば「ingredient」、洗剤やペーパー類等の日用品であれば「daily」、それ以外の非在庫対象であれば「other」としてください。\n' +
  '- 数量が不明または未記載の場合は1としてください。\n' +
  '- 単価または金額には値引き等を考慮した数値を設定してください。';

/**
 * OCR結果データのGAS側二次詳細検証
 * 必須項目、型、正数、空文字、日付形式、明細行の妥当性を厳格に検証する。
 * @param {*} data 検証対象データ
 * @returns {{valid: boolean, error?: string}}
 */
function validateReceiptData_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Receipt data must be a non-null object.' };
  }

  // 1. 店舗名検証
  if (typeof data.store !== 'string' || data.store.trim() === '') {
    return { valid: false, error: 'Receipt store name must be a non-empty string.' };
  }

  // 2. 日付検証 (YYYY-MM-DD)
  if (typeof data.date !== 'string') {
    return { valid: false, error: 'Receipt date must be a string.' };
  }
  var dateMatch = data.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return { valid: false, error: 'Receipt date format must be YYYY-MM-DD, got: ' + data.date };
  }
  var parsedDate = new Date(data.date);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, error: 'Receipt date is invalid calendar date: ' + data.date };
  }

  // 3. 合計金額検証
  if (typeof data.total !== 'number' || isNaN(data.total) || data.total < 0) {
    return { valid: false, error: 'Receipt total must be a non-negative number.' };
  }

  // 4. 明細配列検証
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

    // 商品名
    if (typeof item.name !== 'string' || item.name.trim() === '') {
      return { valid: false, error: path + '.name must be a non-empty string.' };
    }

    // 数量 (1以上)
    if (typeof item.quantity !== 'number' || isNaN(item.quantity) || item.quantity < 1) {
      return { valid: false, error: path + '.quantity must be a number >= 1.' };
    }

    // 単価 (0以上)
    if (typeof item.unitPrice !== 'number' || isNaN(item.unitPrice) || item.unitPrice < 0) {
      return { valid: false, error: path + '.unitPrice must be a non-negative number.' };
    }

    // 金額 (0以上)
    if (typeof item.amount !== 'number' || isNaN(item.amount) || item.amount < 0) {
      return { valid: false, error: path + '.amount must be a non-negative number.' };
    }

    // カテゴリ
    if (validCategories.indexOf(item.category) === -1) {
      return { valid: false, error: path + '.category must be one of: ' + validCategories.join(', ') + '.' };
    }

    // stockType
    if (validStockTypes.indexOf(item.stockType) === -1) {
      return { valid: false, error: path + '.stockType must be one of: ' + validStockTypes.join(', ') + '.' };
    }
  }

  return { valid: true };
}

/**
 * レシート画像を解析して構造化OCRデータを取得するサービス関数
 * 
 * @param {string} base64Image 最適化されたレシート画像のBase64文字列（DataURL可）
 * @param {Object} [options] 呼び出しオプション（モデル指定、テスト用モック等）
 * @returns {{ok: true, data: Object}|{ok: false, error: {type: string, message: string}}}
 */
function processReceiptImage(base64Image, options) {
  options = options || {};

  // 1. 入力値検証 (SYSTEM_ERROR)
  if (!base64Image || typeof base64Image !== 'string' || base64Image.trim() === '') {
    return {
      ok: false,
      error: {
        type: 'SYSTEM_ERROR',
        message: 'Invalid input: base64Image must be a non-empty string.'
      }
    };
  }

  // 2. DataURL プレフィックスの解析と純粋なBase64データの抽出
  var mimeType = 'image/jpeg'; // デフォルト
  var cleanBase64 = base64Image.trim();

  var dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1];
    cleanBase64 = dataUrlMatch[2].trim();
  }

  if (cleanBase64 === '') {
    return {
      ok: false,
      error: {
        type: 'SYSTEM_ERROR',
        message: 'Invalid input: Base64 image payload is empty.'
      }
    };
  }

  // 3. Gemini Multimodal 呼び出し用オプション設定
  var geminiOptions = {};
  for (var key in options) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      geminiOptions[key] = options[key];
    }
  }

  geminiOptions.inlineData = {
    mimeType: mimeType,
    data: cleanBase64
  };

  // 4. TASK-001共通基盤 callGeminiStructured の呼び出し
  var geminiResult;
  try {
    if (typeof callGeminiStructured !== 'function') {
      return {
        ok: false,
        error: {
          type: 'SYSTEM_ERROR',
          message: 'callGeminiStructured is not available.'
        }
      };
    }
    geminiResult = callGeminiStructured(RECEIPT_OCR_PROMPT, RECEIPT_OCR_SCHEMA, geminiOptions);
  } catch (err) {
    return {
      ok: false,
      error: {
        type: 'SYSTEM_ERROR',
        message: 'Unexpected failure during Gemini API invocation: ' + (err.message || 'unknown error')
      }
    };
  }

  // 5. Gemini呼び出し結果判定
  if (!geminiResult || !geminiResult.ok) {
    return geminiResult || {
      ok: false,
      error: {
        type: 'GEMINI_API_ERROR',
        message: 'Failed to process receipt image via Gemini API.'
      }
    };
  }

  // 6. GAS側二次詳細検証 (データ整合性・論理ルール)
  var validation = validateReceiptData_(geminiResult.data);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        type: 'SCHEMA_ERROR',
        message: 'OCR result validation failed: ' + validation.error
      }
    };
  }

  // 7. 検証済み構造化データの返却（※Spreadsheetへの保存は行わない）
  return {
    ok: true,
    data: geminiResult.data
  };
}

/**
 * ReceiptService 自己診断・単体テスト用エントリポイント
 * モック環境で正常系・全異常系（入力エラー、JSON不正、型、必須項目、空文字、スキーマ違反、APIエラー等）を検証する
 * @returns {{passed: number, failed: number, details: Array<string>}}
 */
function testReceiptService() {
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

  var validReceiptData = {
    store: 'テストスーパー 渋谷店',
    date: '2026-09-26',
    total: 1080,
    items: [
      {
        name: '国産豚ロース肉',
        quantity: 2,
        unitPrice: 390,
        amount: 780,
        category: '食費',
        stockType: 'ingredient'
      },
      {
        name: 'キッチンペーパー',
        quantity: 1,
        unitPrice: 300,
        amount: 300,
        category: '日用品',
        stockType: 'daily'
      }
    ]
  };

  var dummyBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...';

  // Test 1: 正常系 (有効な画像入力 -> 正しい構造化データ返却)
  var res1 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(validReceiptData) }] }
          }]
        })
      };
    }
  });
  assert(res1.ok === true && res1.data.store === 'テストスーパー 渋谷店' && res1.data.items.length === 2, '1. 正常系: レシート画像から構造化データが正常に取得できること');

  // Test 2: 異常系: 入力画像なし / 空文字 (SYSTEM_ERROR)
  var res2 = processReceiptImage('', { apiKey: 'dummy-key' });
  assert(res2.ok === false && res2.error.type === 'SYSTEM_ERROR', '2. 異常系: 空文字入力時にSYSTEM_ERRORとなること');

  // Test 3: 異常系: DataURLのBase64部が空 (SYSTEM_ERROR)
  var res3 = processReceiptImage('data:image/jpeg;base64,', { apiKey: 'dummy-key' });
  assert(res3.ok === false && res3.error.type === 'SYSTEM_ERROR', '3. 異常系: Base64部空時にSYSTEM_ERRORとなること');

  // Test 4: 異常系: Gemini APIが不正構文JSONを返却 (SCHEMA_ERROR)
  var res4 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: '{ invalid_receipt_json: ' }] }
          }]
        })
      };
    }
  });
  assert(res4.ok === false && res4.error.type === 'SCHEMA_ERROR', '4. 異常系: JSON構文不正時にSCHEMA_ERRORとなること');

  // Test 5: 異常系: 必須項目欠落 (store欠落 -> SCHEMA_ERROR)
  var invalidData5 = JSON.parse(JSON.stringify(validReceiptData));
  delete invalidData5.store;
  var res5 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData5) }] }
          }]
        })
      };
    }
  });
  assert(res5.ok === false && res5.error.type === 'SCHEMA_ERROR', '5. 異常系: 店舗名欠落時にSCHEMA_ERRORとなること');

  // Test 6: 異常系: 店舗名が空文字 (GAS側二次検証 -> SCHEMA_ERROR)
  var invalidData6 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData6.store = '   ';
  var res6 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData6) }] }
          }]
        })
      };
    }
  });
  assert(res6.ok === false && res6.error.type === 'SCHEMA_ERROR', '6. 異常系: 店舗名が空白文字列時にSCHEMA_ERRORとなること');

  // Test 7: 異常系: 不正な日付形式 (YYYY/MM/DD -> SCHEMA_ERROR)
  var invalidData7 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData7.date = '2026/09/26';
  var res7 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData7) }] }
          }]
        })
      };
    }
  });
  assert(res7.ok === false && res7.error.type === 'SCHEMA_ERROR', '7. 異常系: 日付形式不正時にSCHEMA_ERRORとなること');

  // Test 8: 異常系: 明細アイテムが空配列 (SCHEMA_ERROR)
  var invalidData8 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData8.items = [];
  var res8 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData8) }] }
          }]
        })
      };
    }
  });
  assert(res8.ok === false && res8.error.type === 'SCHEMA_ERROR', '8. 異常系: 明細アイテムが空配列時にSCHEMA_ERRORとなること');

  // Test 9: 異常系: 明細の商品名が空文字 (SCHEMA_ERROR)
  var invalidData9 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData9.items[0].name = '';
  var res9 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData9) }] }
          }]
        })
      };
    }
  });
  assert(res9.ok === false && res9.error.type === 'SCHEMA_ERROR', '9. 異常系: 商品名が空文字時にSCHEMA_ERRORとなること');

  // Test 10: 異常系: 数量が0または負数 (SCHEMA_ERROR)
  var invalidData10 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData10.items[0].quantity = 0;
  var res10 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData10) }] }
          }]
        })
      };
    }
  });
  assert(res10.ok === false && res10.error.type === 'SCHEMA_ERROR', '10. 異常系: 数量が0時にSCHEMA_ERRORとなること');

  // Test 11: 異常系: 許容外カテゴリ (SCHEMA_ERROR)
  var invalidData11 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData11.items[0].category = 'レジャー';
  var res11 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData11) }] }
          }]
        })
      };
    }
  });
  assert(res11.ok === false && res11.error.type === 'SCHEMA_ERROR', '11. 異常系: 許容外カテゴリ時にSCHEMA_ERRORとなること');

  // Test 12: 異常系: 許容外stockType (SCHEMA_ERROR)
  var invalidData12 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData12.items[0].stockType = 'unknown_type';
  var res12 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData12) }] }
          }]
        })
      };
    }
  });
  assert(res12.ok === false && res12.error.type === 'SCHEMA_ERROR', '12. 異常系: 許容外stockType時にSCHEMA_ERRORとなること');

  // Test 13: 異常系: 想定外プロパティの混入 (additionalProperties: false -> SCHEMA_ERROR)
  var invalidData13 = JSON.parse(JSON.stringify(validReceiptData));
  invalidData13.unexpectedField = 'invalid';
  var res13 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(invalidData13) }] }
          }]
        })
      };
    }
  });
  assert(res13.ok === false && res13.error.type === 'SCHEMA_ERROR', '13. 異常系: 想定外プロパティ混入時にSCHEMA_ERRORとなること');

  // Test 14: 異常系: Gemini API 通信エラー (HTTP 500 -> GEMINI_API_ERROR)
  var res14 = processReceiptImage(dummyBase64, {
    apiKey: 'dummy-key',
    maxRetries: 0,
    fetcher: function() {
      return {
        statusCode: 500,
        text: 'Internal Server Error'
      };
    }
  });
  assert(res14.ok === false && res14.error.type === 'GEMINI_API_ERROR', '14. 異常系: Gemini API通信エラー時にGEMINI_API_ERRORとなること');

  return results;
}

/**
 * GAS IDE 実機実行用: 全単体テスト自己診断ランナー
 * GASエディタの「実行」から呼び出すことで、GAS V8エンジン上での動作とログを確認できる。
 */
function testReceiptServiceSelfCheck() {
  console.log('[testReceiptServiceSelfCheck] Starting test suite...');
  var res = testReceiptService();
  console.log('[testReceiptServiceSelfCheck] Results: ' + res.passed + ' passed, ' + res.failed + ' failed.');
  for (var i = 0; i < res.details.length; i++) {
    console.log(res.details[i]);
  }
  if (res.failed > 0) {
    throw new Error('testReceiptServiceSelfCheck failed with ' + res.failed + ' failure(s).');
  }
  return res;
}

/**
 * GAS IDE 実機実行用: ケースD (Schema不適合の検知・拒否) 検証
 * 意図的にSchema不適合となるデータを投入し、GAS側で確実に拒否されることを実機ログに出力する。
 */
function testReceiptSchemaValidationLive() {
  console.log('[testReceiptSchemaValidationLive] Starting Schema rejection verification...');

  // 不正パターン1: 店舗名が空
  var test1 = validateReceiptData_({
    store: '',
    date: '2026-09-26',
    total: 1000,
    items: [{ name: '商品A', quantity: 1, unitPrice: 1000, amount: 1000, category: '食費', stockType: 'ingredient' }]
  });
  console.log('[testReceiptSchemaValidationLive] Pattern 1 (empty store): valid=' + test1.valid + ', error=' + test1.error);

  // 不正パターン2: 日付形式不正 (スラッシュ区切り)
  var test2 = validateReceiptData_({
    store: 'テスト店',
    date: '2026/09/26',
    total: 1000,
    items: [{ name: '商品A', quantity: 1, unitPrice: 1000, amount: 1000, category: '食費', stockType: 'ingredient' }]
  });
  console.log('[testReceiptSchemaValidationLive] Pattern 2 (invalid date format): valid=' + test2.valid + ', error=' + test2.error);

  // 不正パターン3: 数量が0 (minimum: 1 違反)
  var test3 = validateReceiptData_({
    store: 'テスト店',
    date: '2026-09-26',
    total: 1000,
    items: [{ name: '商品A', quantity: 0, unitPrice: 1000, amount: 1000, category: '食費', stockType: 'ingredient' }]
  });
  console.log('[testReceiptSchemaValidationLive] Pattern 3 (quantity < 1): valid=' + test3.valid + ', error=' + test3.error);

  // 不正パターン4: カテゴリがenum外
  var test4 = validateReceiptData_({
    store: 'テスト店',
    date: '2026-09-26',
    total: 1000,
    items: [{ name: '商品A', quantity: 1, unitPrice: 1000, amount: 1000, category: '趣味', stockType: 'ingredient' }]
  });
  console.log('[testReceiptSchemaValidationLive] Pattern 4 (invalid category enum): valid=' + test4.valid + ', error=' + test4.error);

  // 不正パターン5: stockTypeがenum外
  var test5 = validateReceiptData_({
    store: 'テスト店',
    date: '2026-09-26',
    total: 1000,
    items: [{ name: '商品A', quantity: 1, unitPrice: 1000, amount: 1000, category: '食費', stockType: 'unknown' }]
  });
  console.log('[testReceiptSchemaValidationLive] Pattern 5 (invalid stockType enum): valid=' + test5.valid + ', error=' + test5.error);

  var allRejected = (!test1.valid) && (!test2.valid) && (!test3.valid) && (!test4.valid) && (!test5.valid);
  if (!allRejected) {
    throw new Error('Schema rejection test failed: Some invalid patterns were accepted!');
  }

  console.log('[testReceiptSchemaValidationLive] Result: ALL INVALID PATTERNS REJECTED (PASS)');
  return {
    ok: true,
    message: 'All Schema mismatch patterns correctly rejected.'
  };
}

// Node.js環境でのテスト互換性用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RECEIPT_OCR_SCHEMA: RECEIPT_OCR_SCHEMA,
    RECEIPT_OCR_PROMPT: RECEIPT_OCR_PROMPT,
    validateReceiptData_: validateReceiptData_,
    processReceiptImage: processReceiptImage,
    testReceiptService: testReceiptService
  };
}
