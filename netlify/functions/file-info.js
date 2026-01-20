

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// キャッシュ（1時間有効）
const cache = new Map();
const CACHE_TTL = 3600 * 1000;

/**
 * GitHub API リクエスト（GET のみ）
 * @param {string} path - API パス
 * @returns {Promise<Object>}
 */
async function githubRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Gofile-Clone-Netlify',
      },
    };

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

    req.end();
  });
}

/**
 * キャッシュにアクセス
 * @param {string} key - キャッシュキー
 * @param {Function} fn - キャッシュミス時に実行
 * @returns {Promise<any>}
 */
async function withCache(key, fn) {
  const now = Date.now();
  const cached = cache.get(key);

  // キャッシュが有効なら返す
  if (cached && now < cached.expiresAt) {
    console.log(`[Cache HIT] ${key}`);
    return cached.value;
  }

  // キャッシュミス
  console.log(`[Cache MISS] ${key}`);
  const value = await fn();

  // キャッシュに保存
  cache.set(key, {
    value: value,
    expiresAt: now + CACHE_TTL,
  });

  return value;
}

/**
 * Release 情報を取得
 * @param {number} releaseId - Release ID
 * @returns {Promise<Object>}
 */
async function getRelease(releaseId) {
  const cacheKey = `release:${releaseId}`;

  return withCache(cacheKey, async () => {
    console.log(`[GitHub] Fetching release ${releaseId}`);

    const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/${releaseId}`;
    const response = await githubRequest(path);

    const data = response.data;

    // メタデータを Release Description から解析
    let metadata = {};
    if (data.body) {
      try {
        metadata = JSON.parse(data.body);
      } catch (e) {
        console.warn('Failed to parse metadata:', e.message);
      }
    }

    return {
      release_id: data.id,
      tag_name: data.tag_name,
      title: data.name || 'Untitled',
      created_at: data.created_at,
      updated_at: data.updated_at,
      assets: (data.assets || []).map((asset) => ({
        id: asset.id,
        name: asset.name,
        size: asset.size,
        download_url: asset.browser_download_url,
        download_count: asset.download_count,
        created_at: asset.created_at,
      })),
      metadata: metadata,
      html_url: data.html_url,
    };
  });
}

/**
 * リポジトリの最新 Release を取得
 * @returns {Promise<Array>}
 */
async function getLatestReleases(limit = 10) {
  const cacheKey = 'releases:latest';

  return withCache(cacheKey, async () => {
    console.log(`[GitHub] Fetching latest ${limit} releases`);

    const path = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=${limit}`;
    const response = await githubRequest(path);

    return response.data.map((data) => ({
      release_id: data.id,
      tag_name: data.tag_name,
      title: data.name,
      created_at: data.created_at,
      download_count: (data.assets || []).reduce(
        (sum, asset) => sum + asset.download_count,
        0
      ),
    }));
  });
}

/**
 * キャッシュをクリア（管理用）
 */
function clearCache(pattern = null) {
  if (!pattern) {
    cache.clear();
    console.log('[Cache] Cleared all');
    return;
  }

  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }

  console.log(`[Cache] Cleared pattern: ${pattern}`);
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
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  // GET のみ許可
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const queryParams = event.queryStringParameters || {};
    const action = queryParams.action || 'get-release';

    let result;

    switch (action) {
      case 'get-release':
        if (!queryParams.releaseId) {
          throw new Error('Missing releaseId parameter');
        }
        result = await getRelease(parseInt(queryParams.releaseId, 10));
        break;

      case 'latest-releases':
        const limit = Math.min(parseInt(queryParams.limit || '10', 10), 50);
        result = await getLatestReleases(limit);
        break;

      case 'clear-cache':
        // 管理用エンドポイント（本番では削除推奨）
        clearCache(queryParams.pattern);
        result = { message: 'Cache cleared' };
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // キャッシュコントロールヘッダー
    const cacheControl = action === 'get-release'
      ? 'public, max-age=3600' // 1時間キャッシュ
      : 'no-cache';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl,
      },
      body: JSON.stringify({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('[Error]', error.message);

    return {
      statusCode: error.message.includes('Missing') ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};