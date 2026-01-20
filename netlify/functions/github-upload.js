

const https = require('https');
const url = require('url');

// Environment Variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// Rate Limiting (簡易版)
const requestCache = new Map();

/**
 * Rate Limit チェック
 * @param {string} clientId - クライアント識別子（IP アドレスなど）
 * @returns {boolean} - リクエスト許可フラグ
 */
function checkRateLimit(clientId) {
  const now = Date.now();
  const window = 3600 * 1000; // 1時間

  if (!requestCache.has(clientId)) {
    requestCache.set(clientId, { count: 0, resetTime: now + window });
  }

  const record = requestCache.get(clientId);

  if (now > record.resetTime) {
    // リセット
    record.count = 0;
    record.resetTime = now + window;
  }

  record.count++;

  // 1時間に60回まで
  return record.count <= 60;
}

/**
 * GitHub API リクエスト
 * @param {string} method - HTTP メソッド
 * @param {string} path - API パス
 * @param {Buffer|string|null} body - リクエストボディ
 * @param {Object} headers - カスタムヘッダー
 * @returns {Promise<Object>} - JSON レスポンス
 */
async function githubRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Gofile-Clone-Netlify',
        'Content-Type': headers['Content-Type'] || 'application/json',
        ...headers,
      },
    };

    if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      body = JSON.stringify(body);
    }

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const json = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, data: json });
          } else {
            const error = data ? JSON.parse(data) : { message: 'Unknown error' };
            reject(new Error(`GitHub API Error (${res.statusCode}): ${error.message}`));
          }
        } catch (e) {
          reject(new Error(`JSON Parse Error: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Network Error: ${e.message}`));
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

/**
 * Release を作成
 * @param {string} releaseTag - タグ名
 * @param {Object} metadata - メタデータ
 * @returns {Promise<Object>} - Release 情報
 */
async function createRelease(releaseTag, metadata) {
  console.log(`[createRelease] Tag: ${releaseTag}`);

  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
  const body = {
    tag_name: releaseTag,
    name: metadata.title || 'Video Upload',
    body: JSON.stringify(metadata, null, 2),
    draft: false,
    prerelease: false,
  };

  const response = await githubRequest('POST', path, body);

  return {
    release_id: response.data.id,
    upload_url: response.data.upload_url,
    html_url: response.data.html_url,
    tag_name: response.data.tag_name,
  };
}

/**
 * Asset をアップロード
 * @param {string} uploadUrl - upload_url（テンプレート）
 * @param {Buffer} fileData - ファイルデータ
 * @param {string} fileName - ファイル名
 * @returns {Promise<Object>} - Asset 情報
 */
async function uploadAsset(uploadUrl, fileData, fileName) {
  console.log(`[uploadAsset] File: ${fileName}, Size: ${fileData.length} bytes`);

  // upload_url テンプレートを展開
  const cleanUrl = uploadUrl.replace('{?name,label}', '');
  const assetUrl = `${cleanUrl}?name=${encodeURIComponent(fileName)}`;

  const path = assetUrl.replace('https://uploads.github.com', '');

  const response = await githubRequest(
    'POST',
    path,
    fileData,
    { 'Content-Type': 'application/octet-stream' }
  );

  return {
    asset_id: response.data.id,
    name: response.data.name,
    download_url: response.data.browser_download_url,
    size: response.data.size,
  };
}

/**
 * Release 情報を取得
 * @param {number} releaseId - Release ID
 * @returns {Promise<Object>} - Release 情報
 */
async function getRelease(releaseId) {
  console.log(`[getRelease] ID: ${releaseId}`);

  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/${releaseId}`;
  const response = await githubRequest('GET', path);

  return {
    release_id: response.data.id,
    tag_name: response.data.tag_name,
    assets: response.data.assets || [],
    created_at: response.data.created_at,
    body: response.data.body,
  };
}

/**
 * Release を削除（Admin用）
 * @param {number} releaseId - Release ID
 * @returns {Promise<boolean>}
 */
async function deleteRelease(releaseId) {
  console.log(`[deleteRelease] ID: ${releaseId}`);

  const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/${releaseId}`;
  await githubRequest('DELETE', path);

  return true;
}

/**
 * Netlify Function メインハンドラー
 */
exports.handler = async (event, context) => {
  // CORS プリフライト
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    };
  }

  // Rate Limit チェック
  const clientIp = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Rate limit exceeded. Max 60 requests per hour.',
      }),
    };
  }

  try {
    // リクエストボディをパース
    const body = JSON.parse(event.body || '{}');
    const action = body.action || 'upload-asset';

    console.log(`[${action}] Request received from ${clientIp}`);

    let response;

    switch (action) {
      case 'create-release':
        response = await createRelease(body.releaseTag, body.metadata);
        break;

      case 'upload-asset':
        if (!body.fileBase64 || !body.uploadUrl) {
          throw new Error('Missing fileBase64 or uploadUrl');
        }

        // Base64 からバッファへ変換
        const fileBuffer = Buffer.from(body.fileBase64, 'base64');
        response = await uploadAsset(body.uploadUrl, fileBuffer, body.fileName);
        break;

      case 'get-info':
        if (!body.releaseId) {
          throw new Error('Missing releaseId');
        }
        response = await getRelease(body.releaseId);
        break;

      case 'delete-release':
        if (!body.releaseId) {
          throw new Error('Missing releaseId');
        }
        response = await deleteRelease(body.releaseId);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    console.log(`[${action}] Success`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: response,
      }),
    };
  } catch (error) {
    console.error('[Error]', error.message);

    return {
      statusCode: error.message.includes('Rate limit') ? 429 : 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};