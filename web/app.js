/**
 * @file web/app.js
 * @description レシート画像最適化・送信クライアントロジック (TASK-002)
 * ブラウザ側でカメラ撮影・選択された画像をリサイズ・圧縮してBase64化し、GASへ送信する。
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
 * 最適化された画像をGASサーバーへ送信する
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
 * バイト数をフォーマット表示するヘルパー関数
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// ブラウザ側 UI イベントおよびDOM初期化ロジック
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  var currentOptimizedData = null;

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

    function handleFile(file) {
      if (!file || !file.type.match(/^image\//)) {
        alert('画像ファイルを選択してください。');
        return;
      }

      if (errorStatus) errorStatus.style.display = 'none';
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
        if (resultContainer) resultContainer.style.display = 'none';

        sendReceiptImageToGas(currentOptimizedData.base64)
          .then(function(res) {
            if (loadingStatus) loadingStatus.style.display = 'none';
            sendBtn.disabled = false;

            if (res && res.ok) {
              if (successStatus) {
                successStatus.textContent = '✅ OCR解析成功: 構造化データを取得しました。';
                successStatus.style.display = 'block';
              }
              if (jsonView) jsonView.textContent = JSON.stringify(res.data, null, 2);
              if (resultContainer) resultContainer.style.display = 'block';
            } else {
              var errMsg = (res && res.error && res.error.message) ? res.error.message : '解析に失敗しました。';
              var errType = (res && res.error && res.error.type) ? res.error.type : 'ERROR';
              if (errorStatus) {
                errorStatus.textContent = '❌ [' + errType + '] ' + errMsg;
                errorStatus.style.display = 'block';
              }
            }
          })
          .catch(function(err) {
            if (loadingStatus) loadingStatus.style.display = 'none';
            sendBtn.disabled = false;
            if (errorStatus) {
              errorStatus.textContent = '❌ システムエラー: ' + (err.message || String(err));
              errorStatus.style.display = 'block';
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

  window.ReceiptOptimizer = {
    optimizeReceiptImage: optimizeReceiptImage,
    sendReceiptImageToGas: sendReceiptImageToGas
  };
}

// Node.jsテスト環境用エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    optimizeReceiptImage: optimizeReceiptImage,
    sendReceiptImageToGas: sendReceiptImageToGas,
    formatBytes: formatBytes
  };
}
