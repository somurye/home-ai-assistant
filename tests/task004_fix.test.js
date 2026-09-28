const fs = require('fs');
const path = require('path');

// リポジトリルートを相対解決 (__dirname から1階層上)
const repoDir = path.join(__dirname, '..');

// 1. web/app.html から export されたモジュールをロード
const appHtml = fs.readFileSync(path.join(repoDir, 'web/app.html'), 'utf8');
const scriptMatch = appHtml.match(/<script>([\s\S]*?)<\/script>/);
const appModule = {};
const appFn = new Function('module', 'exports', 'window', 'document', scriptMatch[1]);
const mockWindow = {};
const mockDoc = { readyState: 'complete', addEventListener: () => {}, getElementById: () => null };
appFn(appModule, appModule.exports = {}, mockWindow, mockDoc);
const { deriveUnitPrice, validateUiInput } = appModule.exports;

// 2. SheetRepository.gs をロード
const sheetRepoCode = fs.readFileSync(path.join(repoDir, 'src/SheetRepository.gs'), 'utf8');
const sheetRepoModule = {};
const sheetRepoFn = new Function('module', 'exports', sheetRepoCode);
sheetRepoFn(sheetRepoModule, sheetRepoModule.exports = {});
const { appendExpenseRows, EXPENSE_HEADERS } = sheetRepoModule.exports;

// 3. ExpenseService.gs をロード
const expenseCode = fs.readFileSync(path.join(repoDir, 'src/ExpenseService.gs'), 'utf8');
const expenseModule = {};
const expenseFn = new Function('module', 'exports', 'appendExpenseRows', expenseCode);
expenseFn(expenseModule, expenseModule.exports = {}, appendExpenseRows);
const { registerExpenses, generateExpenseId } = expenseModule.exports;

// 4. Code.gs をロード
const codeGsContent = fs.readFileSync(path.join(repoDir, 'src/Code.gs'), 'utf8');
const codeModule = {};
const codeFn = new Function('module', 'exports', 'registerExpenses', 'processReceiptImage', 'HtmlService', 'Logger', codeGsContent);
codeFn(codeModule, codeModule.exports = {}, registerExpenses, () => {}, {}, {});

console.log('=== 全モジュールのロード成功 ===');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(' PASS: ' + msg);
  } else {
    failed++;
    console.error(' FAIL: ' + msg);
  }
}

// -------------------------------------------------------------
// Test 1: deriveUnitPrice (DEC-02)
// -------------------------------------------------------------
console.log('\n--- Test 1: deriveUnitPrice ---');
const ocrItem = { name: 'カレー', quantity: 1, unitPrice: 320, amount: 320 };

// 未修正: OCRのunitPriceが保持される
const u1 = deriveUnitPrice({ quantity: 1, amount: 320 }, ocrItem);
assert(u1 === 320, '未修正行はOCRのunitPrice(320)をそのまま保持');

// 数量修正: 1 -> 2, amount 320 -> 単価 160
const u2 = deriveUnitPrice({ quantity: 2, amount: 320 }, ocrItem);
assert(u2 === 160, '数量修正時(2個320円)は320/2=160に再導出');

// 小計修正: 数量1, amount 320 -> 400 -> 単価 400
const u3 = deriveUnitPrice({ quantity: 1, amount: 400 }, ocrItem);
assert(u3 === 400, '小計修正時(1個400円)は400/1=400に再導出');

// 四捨五入テスト: 数量3, amount 1000 -> 333.33... -> 333
const u4 = deriveUnitPrice({ quantity: 3, amount: 1000 }, ocrItem);
assert(u4 === 333, '割り切れない場合(3個1000円)は四捨五入で333に再導出');

// 四捨五入テスト2: 数量3, amount 1001 -> 333.66... -> 334
const u4b = deriveUnitPrice({ quantity: 3, amount: 1001 }, ocrItem);
assert(u4b === 334, '割り切れない場合(3個1001円)は四捨五入で334に再導出');

// ocrItemなし（新規追加行想定）: 数量2, amount 500 -> 250
const u5 = deriveUnitPrice({ quantity: 2, amount: 500 }, null);
assert(u5 === 250, 'OCR情報なし時は小計÷数量で再導出(250)');

// -------------------------------------------------------------
// Test 2: 排他制御 (LockService) & 日付列書式設定 (SheetRepository) (DEC-03, DEC-04)
// -------------------------------------------------------------
console.log('\n--- Test 2: SheetRepository 排他制御 & 日付列書式 ---');
let formatCalled = false;
let setValuesCalled = false;
let lockWaitCalled = false;
let lockReleaseCalled = false;

const mockSheet = {
  getLastRow: () => 1,
  getRange: (row, col, numRows, numCols) => {
    return {
      setNumberFormat: (fmt) => {
        if (col === 2 && fmt === '@') formatCalled = true;
      },
      setValues: (values) => {
        setValuesCalled = true;
      }
    };
  }
};

const mockSpreadsheet = {
  getSheetByName: () => mockSheet
};

const mockLock = {
  waitLock: (timeout) => {
    lockWaitCalled = true;
    assert(timeout === 10000, 'ロック待機時間が10秒(10000ms)であること');
  },
  releaseLock: () => {
    lockReleaseCalled = true;
  }
};

const dummyRows = [[
  'EXP-001', '2026-09-28', '店A', '商品A', '食費', 1, 100, 100, ''
]];

const repoRes = appendExpenseRows(dummyRows, {
  spreadsheet: mockSpreadsheet,
  lock: mockLock
});

assert(repoRes.ok === true, 'appendExpenseRows が正常終了すること');
assert(lockWaitCalled === true, 'waitLock が呼び出されたこと');
assert(lockReleaseCalled === true, 'finally で releaseLock が呼び出されたこと');
assert(formatCalled === true, '日付列(B列)に setNumberFormat("@") が適用されたこと');
assert(setValuesCalled === true, 'setValues がバッチ実行されたこと');

// ロック取得失敗時
console.log('\n--- Test 3: ロック取得失敗テスト (DEC-03) ---');
let failLockReleaseCalled = false;
const mockFailLock = {
  waitLock: () => {
    throw new Error('Lock timeout');
  },
  releaseLock: () => {
    failLockReleaseCalled = true;
  }
};

const repoFailRes = appendExpenseRows(dummyRows, {
  spreadsheet: mockSpreadsheet,
  lock: mockFailLock
});

assert(repoFailRes.ok === false, 'ロック失敗時に ok: false となること');
assert(repoFailRes.error.type === 'LOCK_TIMEOUT', 'error.type が LOCK_TIMEOUT であること');
assert(repoFailRes.error.message.indexOf('Lock timeout') === -1, '生の例外メッセージがmessageに含まれていないこと(汎用メッセージ)');
assert(failLockReleaseCalled === false, 'ロック未取得時に releaseLock は呼ばれないこと');

// -------------------------------------------------------------
// Test 4: エラー文の汎用化 (ExpenseService & Code.gs) (DEC-05)
// -------------------------------------------------------------
console.log('\n--- Test 4: エラー文汎用化テスト ---');
const invalidData = { store: '', date: 'invalid-date', items: [] };
const expRes = registerExpenses(invalidData);
assert(expRes.ok === false, 'バリデーションエラー時に ok: false となること');
assert(expRes.error.type === 'VALIDATION_ERROR', 'error.type が VALIDATION_ERROR であること');
assert(expRes.error.message === '入力データが不正です。内容を確認してください。', 'バリデーションエラーの message が汎用メッセージであること');
assert(expRes.error.message.indexOf('Store name') === -1, '詳細な生エラーがmessageに含まれないこと');

// -------------------------------------------------------------
// Test 5: UI確定応答判定ロジック (DEC-01)
// -------------------------------------------------------------
console.log('\n--- Test 5: UI確定応答判定ロジック ---');
// 【注記】以下の evaluateResponse は web/app.html 内の confirmReceiptDataToGas の
// resolve ハンドラ判定条件式 (`res && res.ok === true && res.data && typeof res.data.registeredCount === 'number'`)
// をテスト側に複製してシミュレーション検証する関数です。
// web/app.html 変更禁止制約に従い、実コードからの関数切り出し・直接実行ではない点に留意してください。
function evaluateResponse(res) {
  if (res && res.ok === true && res.data && typeof res.data.registeredCount === 'number') {
    return {
      success: true,
      msg: '✅ ' + res.data.registeredCount + '件の支出明細を保存しました。',
      buttonDisabled: true
    };
  } else {
    return {
      success: false,
      msg: '⚠️ 保存に失敗しました。時間をおいて再度お試しください。',
      buttonDisabled: false
    };
  }
}

const successRes = { ok: true, data: { registeredCount: 5 } };
const evalSuccess = evaluateResponse(successRes);
assert(evalSuccess.success === true, 'ok:true かつ registeredCount:5 で成功判定');
assert(evalSuccess.msg === '✅ 5件の支出明細を保存しました。', '正しい件数表示メッセージ');

const failRes1 = { ok: false, error: { type: 'REPOSITORY_ERROR', message: 'DB error' } };
const evalFail1 = evaluateResponse(failRes1);
assert(evalFail1.success === false, 'ok:false で失敗判定');
assert(evalFail1.buttonDisabled === false, '失敗時にボタンが再有効化される');
assert(evalFail1.msg.indexOf('DB error') === -1, '生エラーが出ない汎用文言');

const failRes2 = { ok: true }; // data または registeredCount が欠落している場合
const evalFail2 = evaluateResponse(failRes2);
assert(evalFail2.success === false, 'registeredCount 欠落時は偽成功を防ぎ失敗判定となること');

// -------------------------------------------------------------
// Test 6: ExpenseService 既存自己診断テスト (testExpenseService)
// -------------------------------------------------------------
console.log('\n--- Test 6: ExpenseService 既存自己診断テスト ---');
const expInternalResults = expenseModule.exports.testExpenseService();
assert(expInternalResults.failed === 0, 'testExpenseService の全件合格 (合格: ' + expInternalResults.passed + ', 失敗: ' + expInternalResults.failed + ')');

console.log('\n=== テスト結果サマリー ===');
console.log('合格: ' + passed + ', 失敗: ' + failed);
if (failed > 0) process.exit(1);
