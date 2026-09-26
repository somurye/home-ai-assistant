/**
 * @file web/app.js
 * @description レシート画像最適化・送信およびOCR確認・修正クライアントロジック (TASK-002, TASK-003)
 * ブラウザ側でカメラ撮影・選択された画像をリサイズ・圧縮してBase64化し、GASへ送信する。
 * OCR成功後は確認画面を展開し、ユーザーによる修正・確認および確定操作を制御する。
 * ※GASサーバーサイド環境およびブラウザ環境の両方でエラーなく動作する安全設計。
 */

/**
 * 画像最適化ユーティリティ
 * docs/SPEC.md §11準拠: スマートフォン撮影原画像をリサイズ・JPEG圧縮しBase64化
 *
 * @param {File|Blob} file 入力画像ファイル
 * @param {Object} [options] 最適化オプション
 * @param {number} [options.maxDimension=1200] 最大幅または高さ（px）
 * @param {number} [options.quality=0.8] JPEG圧縮品質 (0.0〜1.0)
 * @returns {Promise<{base64: string, mimeType: string, originalWidth: number, originalHeight: number, optimizedWidth: number, optimizedHeight: number, originalSizeBytes: number, optimizedSizeBytes: number, compressionRatio: number}>}
 */
function optimizeReceiptImage(file, options) {
  options = options || {};
  var maxDimension = options.maxDimension || 1200;
  var quality = options.quality !== undefined ? options.quality : 0.8;

  return new Promise(function(resolve, reject) {
    if (!file) {
      return reject(new Error('ファイルが指定されていません。'));
    }

    var originalSizeBytes = file.size;
    var reader = new FileReader();

    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var origWidth = img.naturalWidth || img.width;
        var origHeight = img.naturalHeight || img.height;

        var targetWidth = origWidth;
        var targetHeight = origHeight;

        // アスペクト比を維持してmaxDimension内にリサイズ
        if (origWidth > maxDimension || origHeight > maxDimension) {
          if (origWidth >= origHeight) {
            targetWidth = maxDimension;
            targetHeight = Math.round((origHeight * maxDimension) / origWidth);
          } else {
            targetHeight = maxDimension;
            targetWidth = Math.round((origWidth * maxDimension) / origHeight);
          }
        }

        var canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        var ctx = canvas.getContext('2d');
        // 高品質スケーリング
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        var mimeType = 'image/jpeg';
        var base64DataUrl = canvas.toDataURL(mimeType, quality);
        
        // Base64バイト数の概算算出
        var base64Content = base64DataUrl.split(',')[1] || '';
        var optimizedSizeBytes = Math.round((base64Content.length * 3) / 4);
        var ratio = originalSizeBytes > 0 
          ? Math.round((optimizedSizeBytes / originalSizeBytes) * 100) 
          : 100;

        resolve({
          base64: base64DataUrl,
          mimeType: mimeType,
          originalWidth: origWidth,
          originalHeight: origHeight,
          optimizedWidth: targetWidth,
          optimizedHeight: targetHeight,
          originalSizeBytes: originalSizeBytes,
          optimizedSizeBytes: optimizedSizeBytes,
          compressionRatio: ratio
        });
      };

      img.onerror = function() {
        reject(new Error('画像オブジェクトの読み込みに失敗しました。'));
      };

      img.src = e.target.result;
    };

    reader.onerror = function() {
      reject(new Error('FileReaderでのファイル読み込みに失敗しました。'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * 最適化された画像をGASサーバーへ送信する (TASK-002)
 * 
 * @param {string} base64Data 最適化済みBase64画像文字列
 * @returns {Promise<Object>} OCR結果オブジェクト {ok: boolean, data?: Object, error?: Object}
 */
function sendReceiptImageToGas(base64Data) {
  return new Promise(function(resolve, reject) {
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run
        .withSuccessHandler(function(response) {
          resolve(response);
        })
        .withFailureHandler(function(err) {
          reject(err);
        })
        .receiveReceiptImage(base64Data);
    } else {
      reject(new Error('GAS実行環境 (google.script.run) が利用できません。'));
    }
  });
}

/**
 * ユーザー確認・修正済みデータを確定操作として送信する (TASK-003)
 * ※本タスクではSpreadsheetへの保存は行わず、確定受付のみを行う（TASK-004で保存実装）。
 * 
 * @param {Object} confirmedData 確定対象データ
 * @returns {Promise<Object>} 確定結果オブジェクト
 */
function confirmReceiptDataToGas(confirmedData) {
  return new Promise(function(resolve, reject) {
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run
        .withSuccessHandler(function(response) {
          resolve(response);
        })
        .withFailureHandler(function(err) {
          reject(err);
        })
        .confirmReceiptData(confirmedData);
    } else {
      // ローカル/モック環境
      resolve({
        ok: true,
        message: 'Receipt data confirmed locally.',
        data: confirmedData
      });
    }
  });
}

/**
 * バイト数をフォーマット表示するヘルパー関数
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * UI上の入力検証を行う (TASK-003)
 * ユーザーが入力したレシート情報および商品明細の空欄・明らかな不正値を検査する。
 * @param {Object} data フォームから収集したレシートデータ
 * @returns {{valid: boolean, error?: string}}
 */
function validateUiInput(data) {
  if (!data) return { valid: false, error: 'データが存在しません。' };

  if (!data.store || data.store.trim() === '') {
    return { valid: false, error: '店舗名を入力してください。' };
  }

  if (!data.date || !data.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return { valid: false, error: '有効な日付 (YYYY-MM-DD) を入力してください。' };
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { valid: false, error: '商品明細が少なくとも1件必要です。' };
  }

  var validCategories = ['食費', '日用品', 'その他'];
  var validStockTypes = ['ingredient', 'daily', 'other'];

  for (var i = 0; i < data.items.length; i++) {
    var item = data.items[i];
    var num = i + 1;

    if (!item.name || item.name.trim() === '') {
      return { valid: false, error: '商品 #' + num + ' の商品名を入力してください。' };
    }

    if (typeof item.quantity !== 'number' || isNaN(item.quantity) || item.quantity < 1) {
      return { valid: false, error: '商品 #' + num + ' の数量は1以上の数値を入力してください。' };
    }

    if (typeof item.amount !== 'number' || isNaN(item.amount) || item.amount < 0) {
      return { valid: false, error: '商品 #' + num + ' の金額は0以上の数値を入力してください。' };
    }

    if (validCategories.indexOf(item.category) === -1) {
      return { valid: false, error: '商品 #' + num + ' のカテゴリが不正です。' };
    }

    if (validStockTypes.indexOf(item.stockType) === -1) {
      return { valid: false, error: '商品 #' + num + ' の在庫区分が不正です。' };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// ブラウザ側 UI イベントおよびDOM初期化ロジック
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  var currentOptimizedData = null;
  var currentOcrResult = null;

  function initReceiptApp() {
    var cameraInput = document.getElementById('cameraInput');
    var fileInput = document.getElementById('fileInput');
    var sendBtn = document.getElementById('sendBtn');
    var previewContainer = document.getElementById('previewContainer');
    var previewImg = document.getElementById('previewImg');
    var origSizeEl = document.getElementById('origSize');
    var optSizeEl = document.getElementById('optSize');
    var dimChangeEl = document.getElementById('dimChange');
    var compRatioEl = document.getElementById('compRatio');
    var loadingStatus = document.getElementById('loadingStatus');
    var errorStatus = document.getElementById('errorStatus');
    var successStatus = document.getElementById('successStatus');
    var resultContainer = document.getElementById('resultContainer');
    var jsonView = document.getElementById('jsonView');

    // TASK-003 UI要素
    var confirmContainer = document.getElementById('confirmContainer');
    var storeInput = document.getElementById('storeInput');
    var dateInput = document.getElementById('dateInput');
    var itemsList = document.getElementById('itemsList');
    var itemCountBadge = document.getElementById('itemCountBadge');
    var totalAmountDisplay = document.getElementById('totalAmountDisplay');
    var validationError = document.getElementById('validationError');
    var confirmBtn = document.getElementById('confirmBtn');
    var confirmSuccessStatus = document.getElementById('confirmSuccessStatus');

    function handleFile(file) {
      if (!file || !file.type.match(/^image\//)) {
        alert('画像ファイルを選択してください。');
        return;
      }

      if (errorStatus) errorStatus.style.display = 'none';
      if (successStatus) successStatus.style.display = 'none';
      if (confirmContainer) confirmContainer.style.display = 'none';
      if (confirmSuccessStatus) confirmSuccessStatus.style.display = 'none';
      if (resultContainer) resultContainer.style.display = 'none';
      if (sendBtn) sendBtn.disabled = true;

      optimizeReceiptImage(file, { maxDimension: 1200, quality: 0.8 })
        .then(function(opt) {
          currentOptimizedData = opt;
          if (previewImg) previewImg.src = opt.base64;
          if (origSizeEl) origSizeEl.textContent = formatBytes(opt.originalSizeBytes);
          if (optSizeEl) optSizeEl.textContent = formatBytes(opt.optimizedSizeBytes);
          if (dimChangeEl) dimChangeEl.textContent = opt.originalWidth + 'x' + opt.originalHeight + ' → ' + opt.optimizedWidth + 'x' + opt.optimizedHeight;
          if (compRatioEl) compRatioEl.textContent = (100 - opt.compressionRatio) + '% 削減 (' + opt.compressionRatio + '% に圧縮)';

          if (previewContainer) previewContainer.style.display = 'block';
          if (sendBtn) sendBtn.disabled = false;
        })
        .catch(function(err) {
          alert('画像最適化エラー: ' + err.message);
        });
    }

    if (cameraInput) {
      cameraInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) {
          handleFile(e.target.files[0]);
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) {
          handleFile(e.target.files[0]);
        }
      });
    }

    /**
     * 明細合計金額の再計算表示
     */
    function recalculateTotal() {
      if (!itemsList || !totalAmountDisplay) return;
      var amountInputs = itemsList.querySelectorAll('.item-amount');
      var sum = 0;
      for (var i = 0; i < amountInputs.length; i++) {
        var val = parseFloat(amountInputs[i].value);
        if (!isNaN(val)) sum += val;
      }
      totalAmountDisplay.textContent = '¥' + sum.toLocaleString();
    }

    /**
     * OCR結果データを元に確認・修正画面を生成する (TASK-003)
     * @param {Object} data 
     */
    function renderConfirmationUi(data) {
      if (!confirmContainer || !itemsList) return;

      currentOcrResult = data;
      if (storeInput) storeInput.value = data.store || '';
      if (dateInput) dateInput.value = data.date || '';

      itemsList.innerHTML = '';
      var items = Array.isArray(data.items) ? data.items : [];
      if (itemCountBadge) itemCountBadge.textContent = items.length + '品目';

      items.forEach(function(item, index) {
        var card = document.createElement('div');
        card.className = 'item-card';

        var nameVal = item.name || '';
        var qtyVal = item.quantity !== undefined ? item.quantity : 1;
        var amountVal = item.amount !== undefined ? item.amount : 0;
        var unitPriceVal = item.unitPrice !== undefined ? item.unitPrice : 0;
        var catVal = item.category || '食費';
        var stockVal = item.stockType || 'ingredient';

        card.innerHTML = 
          '<div class="item-card-header">' +
            '<label class="form-label" style="margin-bottom: 2px;">商品 #' + (index + 1) + '</label>' +
            '<input type="text" class="form-control item-name" value="' + escapeHtml(nameVal) + '" placeholder="商品名">' +
          '</div>' +
          '<div class="item-fields-grid">' +
            '<div>' +
              '<label class="form-label">数量</label>' +
              '<input type="number" min="1" class="form-control item-quantity" value="' + qtyVal + '">' +
            '</div>' +
            '<div>' +
              '<label class="form-label">金額(円)</label>' +
              '<input type="number" min="0" class="form-control item-amount" value="' + amountVal + '">' +
            '</div>' +
            '<div>' +
              '<label class="form-label">カテゴリ</label>' +
              '<select class="form-control item-category">' +
                '<option value="食費"' + (catVal === '食費' ? ' selected' : '') + '>食費</option>' +
                '<option value="日用品"' + (catVal === '日用品' ? ' selected' : '') + '>日用品</option>' +
                '<option value="その他"' + (catVal === 'その他' ? ' selected' : '') + '>その他</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="form-label">在庫管理区分</label>' +
              '<select class="form-control item-stock-type">' +
                '<option value="ingredient"' + (stockVal === 'ingredient' ? ' selected' : '') + '>食材 (在庫対象)</option>' +
                '<option value="daily"' + (stockVal === 'daily' ? ' selected' : '') + '>日用品</option>' +
                '<option value="other"' + (stockVal === 'other' ? ' selected' : '') + '>その他 (非対象)</option>' +
              '</select>' +
            '</div>' +
          '</div>';

        // 数量・金額変更時のイベントリスナー
        var amtInput = card.querySelector('.item-amount');
        if (amtInput) {
          amtInput.addEventListener('input', recalculateTotal);
        }

        itemsList.appendChild(card);
      });

      recalculateTotal();
      if (validationError) validationError.style.display = 'none';
      if (confirmSuccessStatus) confirmSuccessStatus.style.display = 'none';
      if (confirmBtn) confirmBtn.disabled = false;
      confirmContainer.style.display = 'block';
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // OCR送信ボタン
    if (sendBtn) {
      sendBtn.addEventListener('click', function() {
        if (!currentOptimizedData || !currentOptimizedData.base64) {
          alert('送信対象の画像がありません。');
          return;
        }

        sendBtn.disabled = true;
        if (loadingStatus) loadingStatus.style.display = 'flex';
        if (errorStatus) errorStatus.style.display = 'none';
        if (successStatus) successStatus.style.display = 'none';
        if (confirmContainer) confirmContainer.style.display = 'none';
        if (resultContainer) resultContainer.style.display = 'none';

        sendReceiptImageToGas(currentOptimizedData.base64)
          .then(function(res) {
            if (loadingStatus) loadingStatus.style.display = 'none';
            sendBtn.disabled = false;

            if (res && res.ok) {
              if (successStatus) {
                successStatus.textContent = '✅ OCR解析成功: 読み取り内容を確認・修正してください。';
                successStatus.style.display = 'block';
              }
              if (jsonView) jsonView.textContent = JSON.stringify(res.data, null, 2);
              
              // TASK-003: 確認画面を展開
              renderConfirmationUi(res.data);
            } else {
              var errMsg = (res && res.error && res.error.message) ? res.error.message : '解析に失敗しました。';
              var errType = (res && res.error && res.error.type) ? res.error.type : 'ERROR';
              if (errorStatus) {
                errorStatus.textContent = '❌ [' + errType + '] ' + errMsg;
                errorStatus.style.display = 'block';
              }
              if (confirmContainer) confirmContainer.style.display = 'none';
            }
          })
          .catch(function(err) {
            if (loadingStatus) loadingStatus.style.display = 'none';
            sendBtn.disabled = false;
            if (errorStatus) {
              errorStatus.textContent = '❌ システムエラー: ' + (err.message || String(err));
              errorStatus.style.display = 'block';
            }
            if (confirmContainer) confirmContainer.style.display = 'none';
          });
      });
    }

    // TASK-003: 確定ボタン
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function() {
        if (validationError) validationError.style.display = 'none';

        // フォームから最新データを収集
        var cards = itemsList ? itemsList.querySelectorAll('.item-card') : [];
        var editedItems = [];
        var totalCalc = 0;

        for (var i = 0; i < cards.length; i++) {
          var card = cards[i];
          var name = (card.querySelector('.item-name') || {}).value || '';
          var qty = parseInt((card.querySelector('.item-quantity') || {}).value, 10);
          var amt = parseFloat((card.querySelector('.item-amount') || {}).value);
          var cat = (card.querySelector('.item-category') || {}).value || 'その他';
          var stock = (card.querySelector('.item-stock-type') || {}).value || 'other';

          if (!isNaN(amt)) totalCalc += amt;

          var origUnitPrice = (currentOcrResult && currentOcrResult.items && currentOcrResult.items[i]) 
            ? currentOcrResult.items[i].unitPrice 
            : (qty > 0 ? Math.round(amt / qty) : amt);

          editedItems.push({
            name: name,
            quantity: qty,
            unitPrice: origUnitPrice,
            amount: amt,
            category: cat,
            stockType: stock
          });
        }

        var confirmedPayload = {
          store: storeInput ? storeInput.value : '',
          date: dateInput ? dateInput.value : '',
          total: totalCalc,
          items: editedItems
        };

        // 入力検証
        var validation = validateUiInput(confirmedPayload);
        if (!validation.valid) {
          if (validationError) {
            validationError.textContent = '⚠️ ' + validation.error;
            validationError.style.display = 'block';
          }
          return;
        }

        // 確定操作呼び出し (TASK-003: 保存本体はTASK-004)
        confirmBtn.disabled = true;
        confirmReceiptDataToGas(confirmedPayload)
          .then(function(res) {
            if (confirmSuccessStatus) {
              confirmSuccessStatus.textContent = '✅ レシート内容が確定されました。（※Spreadsheet保存はTASK-004で実行されます）';
              confirmSuccessStatus.style.display = 'block';
            }
          })
          .catch(function(err) {
            confirmBtn.disabled = false;
            if (validationError) {
              validationError.textContent = '❌ 確定処理エラー: ' + (err.message || String(err));
              validationError.style.display = 'block';
            }
          });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReceiptApp);
  } else {
    initReceiptApp();
  }

  window.ReceiptApp = {
    optimizeReceiptImage: optimizeReceiptImage,
    sendReceiptImageToGas: sendReceiptImageToGas,
    confirmReceiptDataToGas: confirmReceiptDataToGas,
    validateUiInput: validateUiInput
  };
}

// Node.jsテスト環境用エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    optimizeReceiptImage: optimizeReceiptImage,
    sendReceiptImageToGas: sendReceiptImageToGas,
    confirmReceiptDataToGas: confirmReceiptDataToGas,
    formatBytes: formatBytes,
    validateUiInput: validateUiInput
  };
}
