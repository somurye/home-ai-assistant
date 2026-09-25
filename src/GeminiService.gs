/**
 * @file GeminiService.gs
 * @description Gemini API Structured Output 共通基盤
 * TASK-001: 共通呼び出し、Structured Output (JSON Schema)、汎用構造検証、エラー分類、リトライ基盤
 */

/**
 * エラータイプ定義
 */
var GeminiErrorType = {
  GEMINI_API_ERROR: 'GEMINI_API_ERROR',
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  SYSTEM_ERROR: 'SYSTEM_ERROR'
};

/**
 * 成功レスポンスを生成するヘルパー
 * @param {*} data 
 * @returns {{ok: true, data: *}}
 */
function createGeminiSuccess_(data) {
  return {
    ok: true,
    data: data
  };
}

/**
 * エラーレスポンスを生成するヘルパー
 * @param {string} type エラータイプ (GeminiErrorType)
 * @param {string} message エラーメッセージ（サニタイズ済み）
 * @returns {{ok: false, error: {type: string, message: string}}}
 */
function createGeminiError_(type, message) {
  return {
    ok: false,
    error: {
      type: type,
      message: message || 'An unknown error occurred.'
    }
  };
}

/**
 * PropertiesServiceから安全にGemini APIキーを取得する
 * @returns {string|null}
 */
function getGeminiApiKey_() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var props = PropertiesService.getScriptProperties();
      var key = props.getProperty('GEMINI_API_KEY');
      return key ? key.trim() : null;
    }
  } catch (e) {
    // ログに例外詳細を出力せず安全に処理
  }
  return null;
}

/**
 * Gemini APIへのリクエストペイロードを構築する
 * @param {string} prompt テキストプロンプト
 * @param {Object} schema JSON Schema
 * @param {Object} [options] オプション設定
 * @returns {Object}
 */
function buildGeminiRequestPayload_(prompt, schema, options) {
  options = options || {};
  var parts = [];

  // テキストプロンプトの追加
  if (prompt && typeof prompt === 'string') {
    parts.push({ text: prompt });
  }

  // Multimodal対応: inlineData (画像等) が指定されている場合
  if (options.inlineData) {
    var inlineList = Array.isArray(options.inlineData) ? options.inlineData : [options.inlineData];
    for (var i = 0; i < inlineList.length; i++) {
      var item = inlineList[i];
      if (item && item.mimeType && item.data) {
        parts.push({
          inlineData: {
            mimeType: item.mimeType,
            data: item.data
          }
        });
      }
    }
  }

  var contents = [
    {
      role: 'user',
      parts: parts
    }
  ];

  // generationConfig: responseFormat.text.mimeType / responseFormat.text.schema を厳守
  var generationConfig = {
    responseFormat: {
      text: {
        mimeType: 'APPLICATION_JSON'
      }
    }
  };

  if (schema && typeof schema === 'object') {
    generationConfig.responseFormat.text.schema = schema;
  }

  if (options.temperature !== undefined) {
    generationConfig.temperature = options.temperature;
  }
  if (options.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = options.maxOutputTokens;
  }

  var payload = {
    contents: contents,
    generationConfig: generationConfig
  };

  return payload;
}

/**
 * 汎用JSON Schema構造検証関数
 * 外部ライブラリに依存せず、GAS環境で標準動作する汎用バリデータ
 * @param {*} data 検証対象データ
 * @param {Object} schema JSON Schema定義
 * @param {string} [path] エラー通知用パス
 * @returns {{valid: boolean, error?: string}}
 */
function validateGenericStructure_(data, schema, path) {
  path = path || 'root';

  if (!schema || typeof schema !== 'object') {
    return { valid: true };
  }

  // 1. null / undefined チェック
  if (data === undefined || data === null) {
    return { valid: false, error: 'Value at ' + path + ' must not be null or undefined.' };
  }

  // 2. type チェック
  if (schema.type) {
    var actualType = typeof data;
    if (schema.type === 'object') {
      if (actualType !== 'object' || data === null || Array.isArray(data)) {
        return { valid: false, error: 'Value at ' + path + ' must be an object, but got ' + (Array.isArray(data) ? 'array' : actualType) + '.' };
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(data)) {
        return { valid: false, error: 'Value at ' + path + ' must be an array, but got ' + actualType + '.' };
      }
    } else if (schema.type === 'string') {
      if (actualType !== 'string') {
        return { valid: false, error: 'Value at ' + path + ' must be a string, but got ' + actualType + '.' };
      }
    } else if (schema.type === 'number') {
      if (actualType !== 'number' || isNaN(data)) {
        return { valid: false, error: 'Value at ' + path + ' must be a number, but got ' + actualType + '.' };
      }
    } else if (schema.type === 'integer') {
      if (actualType !== 'number' || isNaN(data) || !Number.isInteger(data)) {
        return { valid: false, error: 'Value at ' + path + ' must be an integer, but got ' + actualType + '.' };
      }
    } else if (schema.type === 'boolean') {
      if (actualType !== 'boolean') {
        return { valid: false, error: 'Value at ' + path + ' must be a boolean, but got ' + actualType + '.' };
      }
    }
  }

  // 3. enum チェック
  if (Array.isArray(schema.enum)) {
    if (schema.enum.indexOf(data) === -1) {
      return { valid: false, error: 'Value at ' + path + ' is not one of the allowed enum values: ' + JSON.stringify(schema.enum) + '.' };
    }
  }

  // 4. pattern チェック (string)
  if (schema.pattern && typeof data === 'string') {
    try {
      var reg = new RegExp(schema.pattern);
      if (!reg.test(data)) {
        return { valid: false, error: 'Value at ' + path + ' does not match pattern: ' + schema.pattern + '.' };
      }
    } catch (e) {
      // 正規表現構文例外
    }
  }

  // 5. minimum / maximum チェック (number / integer)
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      return { valid: false, error: 'Value at ' + path + ' (' + data + ') is less than minimum (' + schema.minimum + ').' };
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      return { valid: false, error: 'Value at ' + path + ' (' + data + ') is greater than maximum (' + schema.maximum + ').' };
    }
  }

  // 6. object 検証: required, properties, additionalProperties
  if (schema.type === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    // 6.1 必須キーチェック
    if (Array.isArray(schema.required)) {
      for (var r = 0; r < schema.required.length; r++) {
        var reqKey = schema.required[r];
        if (!Object.prototype.hasOwnProperty.call(data, reqKey) || data[reqKey] === undefined || data[reqKey] === null) {
          return { valid: false, error: 'Required property "' + reqKey + '" is missing or null at ' + path + '.' };
        }
      }
    }

    // 6.2 additionalProperties チェック
    if (schema.additionalProperties === false && schema.properties) {
      var dataKeys = Object.keys(data);
      for (var k = 0; k < dataKeys.length; k++) {
        var propKey = dataKeys[k];
        if (!Object.prototype.hasOwnProperty.call(schema.properties, propKey)) {
          return { valid: false, error: 'Unrecognized property "' + propKey + '" found at ' + path + ' where additionalProperties is false.' };
        }
      }
    }

    // 6.3 properties の再帰検証
    if (schema.properties && typeof schema.properties === 'object') {
      var definedKeys = Object.keys(schema.properties);
      for (var p = 0; p < definedKeys.length; p++) {
        var pName = definedKeys[p];
        if (Object.prototype.hasOwnProperty.call(data, pName) && data[pName] !== undefined) {
          var propRes = validateGenericStructure_(data[pName], schema.properties[pName], path + '.' + pName);
          if (!propRes.valid) {
            return propRes;
          }
        }
      }
    }
  }

  // 7. array 検証: minItems, maxItems, items
  if (schema.type === 'array' && Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      return { valid: false, error: 'Array length at ' + path + ' (' + data.length + ') is less than minItems (' + schema.minItems + ').' };
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      return { valid: false, error: 'Array length at ' + path + ' (' + data.length + ') is greater than maxItems (' + schema.maxItems + ').' };
    }
    if (schema.items && typeof schema.items === 'object') {
      for (var idx = 0; idx < data.length; idx++) {
        var itemRes = validateGenericStructure_(data[idx], schema.items, path + '[' + idx + ']');
        if (!itemRes.valid) {
          return itemRes;
        }
      }
    }
  }

  return { valid: true };
}

/**
 * リトライ待機（指数バックオフ用）
 * @param {number} ms 待機時間（ミリ秒）
 */
function sleepMs_(ms) {
  if (typeof Utilities !== 'undefined' && Utilities.sleep) {
    Utilities.sleep(ms);
  } else {
    var start = Date.now();
    while (Date.now() - start < ms) {
      // ビジーループ（テスト環境用フォールバック）
    }
  }
}

/**
 * Gemini Structured Output 共通呼び出し関数
 * 
 * @param {string} prompt テキストプロンプト
 * @param {Object} schema 要求するJSON Schema
 * @param {Object} [options] オプション設定
 * @param {string} [options.model] モデル名（デフォルト: 'gemini-2.5-flash'）
 * @param {string} [options.apiKey] 明示的にAPIキーを渡す場合（通常はPropertiesService優先）
 * @param {Array<Object>|Object} [options.inlineData] Multimodal画像データ ({mimeType, data})
 * @param {number} [options.maxRetries] 最大リトライ回数（デフォルト: 2、上限: 3）
 * @param {number} [options.baseDelayMs] 指数バックオフ基本遅延（デフォルト: 1000ms）
 * @param {Function} [options.fetcher] HTTPリクエスト用モック関数（テスト用）
 * @returns {{ok: true, data: *}|{ok: false, error: {type: string, message: string}}}
 */
function callGeminiStructured(prompt, schema, options) {
  options = options || {};

  // 1. 引数検証 (System Error)
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return createGeminiError_(GeminiErrorType.SYSTEM_ERROR, 'Invalid prompt: prompt must be a non-empty string.');
  }

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return createGeminiError_(GeminiErrorType.SYSTEM_ERROR, 'Invalid schema: schema must be a valid JSON Schema object.');
  }

  // 2. APIキー取得
  var apiKey = (options.apiKey && typeof options.apiKey === 'string') ? options.apiKey.trim() : getGeminiApiKey_();
  if (!apiKey) {
    return createGeminiError_(GeminiErrorType.SYSTEM_ERROR, 'Gemini API key is not configured. Please set GEMINI_API_KEY in Script Properties.');
  }

  // 3. パラメータ初期化
  var model = options.model || 'gemini-3.8-flash';
  var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  var payload = buildGeminiRequestPayload_(prompt, schema, options);

  var maxRetries = Math.min(Math.max(options.maxRetries !== undefined ? options.maxRetries : 2, 0), 3);
  var baseDelayMs = options.baseDelayMs !== undefined ? options.baseDelayMs : 1000;

  var lastError = null;

  // 4. API呼び出し & リトライループ
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      var responseText = '';
      var statusCode = 200;

      if (typeof options.fetcher === 'function') {
        // テスト・モック用フェッチャー
        var fetchRes = options.fetcher({
          endpoint: endpoint,
          payload: payload,
          attempt: attempt,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          }
        });
        responseText = fetchRes.text;
        statusCode = fetchRes.statusCode !== undefined ? fetchRes.statusCode : 200;
      } else if (typeof UrlFetchApp !== 'undefined') {
        // GAS標準 UrlFetchApp
        var fetchOptions = {
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };
        var httpResponse = UrlFetchApp.fetch(endpoint, fetchOptions);
        statusCode = httpResponse.getResponseCode();
        responseText = httpResponse.getContentText();
      } else {
        return createGeminiError_(GeminiErrorType.SYSTEM_ERROR, 'HTTP client environment (UrlFetchApp) is not available.');
      }

      // 4.1 HTTPステータス判定
      if (statusCode !== 200) {
        var isRetryable = (statusCode === 429 || (statusCode >= 500 && statusCode < 600));

        if (isRetryable && attempt < maxRetries) {
          var delay = baseDelayMs * Math.pow(2, attempt);
          sleepMs_(delay);
          continue;
        }

        var errorMsg = 'Gemini API returned HTTP status ' + statusCode + '.';
        if (responseText && typeof responseText === 'string') {
          try {
            var errJson = JSON.parse(responseText);
            if (errJson && errJson.error && errJson.error.message) {
              var detailMsg = errJson.error.message;
              if (errJson.error.status) {
                detailMsg += ' (status: ' + errJson.error.status + ')';
              }
              if (apiKey) {
                detailMsg = detailMsg.split(apiKey).join('[REDACTED]');
              }
              errorMsg += ' Details: ' + detailMsg;
            }
          } catch (e) {
            var rawSnippet = responseText.substring(0, 200).replace(/\s+/g, ' ').trim();
            if (apiKey) {
              rawSnippet = rawSnippet.split(apiKey).join('[REDACTED]');
            }
            if (rawSnippet) {
              errorMsg += ' Raw response: ' + rawSnippet;
            }
          }
        }

        return createGeminiError_(GeminiErrorType.GEMINI_API_ERROR, errorMsg);
      }

      // 4.2 Gemini APIレスポンス本体のパース
      var apiResponseObj;
      try {
        apiResponseObj = JSON.parse(responseText);
      } catch (parseErr) {
        return createGeminiError_(GeminiErrorType.GEMINI_API_ERROR, 'Failed to parse Gemini API HTTP response as JSON.');
      }

      // 4.3 candidates および content の存在確認
      if (!apiResponseObj || !apiResponseObj.candidates || !apiResponseObj.candidates[0]) {
        var candidateErrorMsg = 'Gemini API response contained no candidate.';
        if (apiResponseObj && apiResponseObj.promptFeedback && apiResponseObj.promptFeedback.blockReason) {
          candidateErrorMsg += ' Prompt blocked: ' + apiResponseObj.promptFeedback.blockReason;
        }
        return createGeminiError_(GeminiErrorType.GEMINI_API_ERROR, candidateErrorMsg);
      }

      var candidate = apiResponseObj.candidates[0];
      if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0] || candidate.content.parts[0].text === undefined) {
        return createGeminiError_(GeminiErrorType.GEMINI_API_ERROR, 'Gemini API candidate content text is missing.');
      }

      var structuredText = candidate.content.parts[0].text;

      // 4.4 Structured Output の JSON パース (Schema Error)
      var parsedData;
      try {
        parsedData = JSON.parse(structuredText);
      } catch (jsonErr) {
        return createGeminiError_(GeminiErrorType.SCHEMA_ERROR, 'Failed to parse Gemini structured output text as JSON.');
      }

      // 4.5 汎用構造検証 (Schema Error)
      var validationResult = validateGenericStructure_(parsedData, schema, 'response');
      if (!validationResult.valid) {
        return createGeminiError_(GeminiErrorType.SCHEMA_ERROR, 'Structured output validation failed: ' + validationResult.error);
      }

      // 4.6 成功
      return createGeminiSuccess_(parsedData);

    } catch (netErr) {
      // ネットワーク例外・タイムアウト等
      lastError = netErr;
      if (attempt < maxRetries) {
        var retryDelay = baseDelayMs * Math.pow(2, attempt);
        sleepMs_(retryDelay);
        continue;
      }
    }
  }

  // リトライ上限到達
  return createGeminiError_(
    GeminiErrorType.GEMINI_API_ERROR,
    'Gemini API request failed after ' + (maxRetries + 1) + ' attempts due to network or timeout error.'
  );
}

/**
 * 自己診断・単体テスト用エントリポイント
 * モック環境で正常系・異常系・エラー分類・リトライを検証する
 * @returns {{passed: number, failed: number, details: Array<string>}}
 */
function testGeminiService() {
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

  var dummySchema = {
    type: 'object',
    required: ['status', 'count'],
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['OK', 'ERROR'] },
      count: { type: 'integer', minimum: 0 }
    }
  };

  // Test 1: 正常系 (Valid JSON & Valid Schema)
  var res1 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ status: 'OK', count: 5 }) }] }
          }]
        })
      };
    }
  });
  assert(res1.ok === true && res1.data.status === 'OK' && res1.data.count === 5, '1. 正常系: 正しいデータが返ること');

  // Test 2: JSON不正 (Structured Output parse failure -> SCHEMA_ERROR)
  var res2 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: '{ invalid_json: ' }] }
          }]
        })
      };
    }
  });
  assert(res2.ok === false && res2.error.type === GeminiErrorType.SCHEMA_ERROR, '2. 異常系: JSON不正時にSCHEMA_ERRORとなること');

  // Test 3: 必須キー不足 (required missing -> SCHEMA_ERROR)
  var res3 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ status: 'OK' }) }] } // count missing
          }]
        })
      };
    }
  });
  assert(res3.ok === false && res3.error.type === GeminiErrorType.SCHEMA_ERROR, '3. 異常系: 必須キー欠落時にSCHEMA_ERRORとなること');

  // Test 4: Schema型不一致 (type mismatch -> SCHEMA_ERROR)
  var res4 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ status: 'OK', count: 'five' }) }] } // string instead of integer
          }]
        })
      };
    }
  });
  assert(res4.ok === false && res4.error.type === GeminiErrorType.SCHEMA_ERROR, '4. 異常系: 型不一致時にSCHEMA_ERRORとなること');

  // Test 5: APIエラー (HTTP 500 -> GEMINI_API_ERROR & リトライ動作)
  var retryCount = 0;
  var res5 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    maxRetries: 2,
    baseDelayMs: 1,
    fetcher: function() {
      retryCount++;
      return { statusCode: 500, text: 'Internal Server Error' };
    }
  });
  assert(res5.ok === false && res5.error.type === GeminiErrorType.GEMINI_API_ERROR && retryCount === 3, '5. 異常系: HTTP 500でGEMINI_API_ERRORかつ3回試行されること');

  // Test 6: システムエラー (引数不正: prompt欠落 -> SYSTEM_ERROR)
  var res6 = callGeminiStructured('', dummySchema, { apiKey: 'dummy-key' });
  assert(res6.ok === false && res6.error.type === GeminiErrorType.SYSTEM_ERROR, '6. 異常系: 引数不正時にSYSTEM_ERRORとなること');

  // Test 7: システムエラー (APIキー未設定 -> SYSTEM_ERROR)
  var res7 = callGeminiStructured('prompt', dummySchema, { apiKey: '' });
  assert(res7.ok === false && res7.error.type === GeminiErrorType.SYSTEM_ERROR, '7. 異常系: APIキー未設定時にSYSTEM_ERRORとなること');

  // Test 8: 未定義キー混入 (additionalProperties: false -> SCHEMA_ERROR)
  var res8 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ status: 'OK', count: 5, extraField: 'unauthorized' }) }] }
          }]
        })
      };
    }
  });
  assert(res8.ok === false && res8.error.type === GeminiErrorType.SCHEMA_ERROR, '8. 異常系: additionalProperties: false 違反時にSCHEMA_ERRORとなること');

  // Test 9: enum値不適合 (enum mismatch -> SCHEMA_ERROR)
  var res9 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ status: 'INVALID_ENUM', count: 5 }) }] }
          }]
        })
      };
    }
  });
  assert(res9.ok === false && res9.error.type === GeminiErrorType.SCHEMA_ERROR, '9. 異常系: enum違反時にSCHEMA_ERRORとなること');

  // Test 10: 境界値違反 (minimum -> SCHEMA_ERROR)
  var res10 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    fetcher: function() {
      return {
        statusCode: 200,
        text: JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ status: 'OK', count: -1 }) }] }
          }]
        })
      };
    }
  });
  assert(res10.ok === false && res10.error.type === GeminiErrorType.SCHEMA_ERROR, '10. 異常系: minimum違反時にSCHEMA_ERRORとなること');

  // Test 11: 非リトライ対象エラー (HTTP 400 Bad Request -> リトライせず即座にGEMINI_API_ERROR)
  var retryCount400 = 0;
  var res11 = callGeminiStructured('test prompt', dummySchema, {
    apiKey: 'dummy-key',
    maxRetries: 2,
    baseDelayMs: 1,
    fetcher: function() {
      retryCount400++;
      return { statusCode: 400, text: 'Bad Request' };
    }
  });
  assert(res11.ok === false && res11.error.type === GeminiErrorType.GEMINI_API_ERROR && retryCount400 === 1, '11. 制御: HTTP 400はリトライせず1回で終了すること');

  // Test 12: Multimodalペイロード構築 (inlineData)
  var payload = buildGeminiRequestPayload_('test prompt', dummySchema, {
    inlineData: { mimeType: 'image/jpeg', data: 'BASE64DATA' }
  });
  var hasInline = payload.contents[0].parts.some(function(p) { return p.inlineData && p.inlineData.mimeType === 'image/jpeg'; });
  var hasResponseFormat = payload.generationConfig.responseFormat.text.mimeType === 'APPLICATION_JSON';
  assert(hasInline && hasResponseFormat, '12. Multimodal対応: inlineDataおよびresponseFormatが正しく構築されること');

  return results;
}

/**
 * GAS環境での実機疎通確認用関数
 * Script Properties に設定された GEMINI_API_KEY を使用して実際にAPIを呼び出し、Structured Outputの取得・検証を行う。
 * （※APIキーそのものはログに出力しない）
 * @returns {Object} 呼び出し結果 {ok: boolean, data?: Object, error?: Object}
 */
function testGeminiApiLive() {
  var testSchema = {
    type: 'object',
    required: ['message', 'success'],
    additionalProperties: false,
    properties: {
      message: { type: 'string' },
      success: { type: 'boolean' }
    }
  };

  var prompt = 'Return a JSON object with message "Hello from Gemini" and success true.';
  var result = callGeminiStructured(prompt, testSchema);

  if (typeof Logger !== 'undefined' && Logger.log) {
    Logger.log('[testGeminiApiLive] Result: ' + JSON.stringify(result));
  } else {
    console.log('[testGeminiApiLive] Result: ' + JSON.stringify(result));
  }

  if (!result.ok) {
    throw new Error('testGeminiApiLive failed: ' + JSON.stringify(result.error));
  }

  return result;
}

/**
 * GAS環境での実機異常系検証用関数
 * 不正なモデル指定による GEMINI_API_ERROR のハンドリング等を実機上で確認する。
 * @returns {Object} 検証結果一覧
 */
function testGeminiApiLiveErrorHandling() {
  var testSchema = {
    type: 'object',
    required: ['dummy'],
    properties: {
      dummy: { type: 'string' }
    }
  };

  // 1. 不正モデル指定による API エラー確認
  var invalidModelRes = callGeminiStructured('test', testSchema, {
    model: 'non-existent-model-xyz',
    maxRetries: 0
  });

  return {
    invalidModelTest: invalidModelRes
  };
}

// Node.js環境でのテスト互換性用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GeminiErrorType: GeminiErrorType,
    callGeminiStructured: callGeminiStructured,
    buildGeminiRequestPayload_: buildGeminiRequestPayload_,
    validateGenericStructure_: validateGenericStructure_,
    testGeminiService: testGeminiService,
    testGeminiApiLive: testGeminiApiLive,
    testGeminiApiLiveErrorHandling: testGeminiApiLiveErrorHandling
  };
}
