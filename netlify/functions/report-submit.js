/**
 * netlify/functions/report-submit.js
 * 
 * Discord Webhook を通じてファイル通報を管理する Netlify Function
 * 
 * リクエスト:
 * POST /api/report-submit
 * {
 *   file_url: "https://example.com/v/123",
 *   release_id: "123456789",
 *   reason: "copyright" | "illegal" | "harassment" | etc,
 *   additionalInfo: "違反の詳細",
 *   reporter_ip?: "192.168.1.1"
 * }
 * 
 * レスポンス:
 * {
 *   success: true,
 *   report_id: "uuid",
 *   timestamp: "ISO8601"
 * }
 */

const https = require('https');
const crypto = require('crypto');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 報告理由マップ
const REPORT_REASONS = {
  copyright: '著作権侵害',
  illegal: '違法コンテンツ',
  harassment: 'ハラスメント・脅迫',
  private: 'プライバシー侵害',
  malware: 'マルウェア・ウイルス',
  other: 'その他',
};

/**
 * UUID を生成
 * @returns {string}
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Discord Embed メッセージを構築
 * @param {Object} reportData - 通報データ
 * @returns {Object} - Embed オブジェクト
 */
function buildEmbed(reportData) {
  const timestamp = new Date(reportData.timestamp);

  return {
    title: '🚨 ファイル通報が届きました',
    description: `**理由**: ${REPORT_REASONS[reportData.reason] || '不明'}`,
    color: 0xff5252, // 赤
    fields: [
      {
        name: 'ファイルURL',
        value: `[Link](${reportData.file_url})`,
        inline: false,
      },
      {
        name: 'Release ID',
        value: `\`${reportData.release_id}\``,
        inline: true,
      },
      {
        name: '通報時刻',
        value: timestamp.toLocaleString('ja-JP'),
        inline: true,
      },
      {
        name: '追加情報',
        value: reportData.additionalInfo || 'なし',
        inline: false,
      },
      {
        name: 'Report ID',
        value: `\`${reportData.report_id}\``,
        inline: true,
      },
      {
        name: '通報者IP',
        value: `\`${reportData.reporter_ip || 'Unknown'}\``,
        inline: true,
      },
    ],
    footer: {
      text: 'Gofile Clone Reporting System',
      icon_url: 'https://github.githubassets.com/favicons/favicon.svg',
    },
    timestamp: timestamp.toISOString(),
  };
}

/**
 * Discord Webhook にメッセージを送信
 * @param {Object} payload - Discord Webhook ペイロード
 * @returns {Promise<number>} - ステータスコード
 */
function sendDiscordWebhook(payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(DISCORD_WEBHOOK_URL);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(payload)),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.statusCode);
        } else {
          reject(new Error(`Discord API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Network Error: ${e.message}`));
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * 管理者向けの削除操作手順を追加
 * @param {Object} reportData - 通報データ
 * @returns {string} - Markdown テキスト
 */
function buildAdminInstructions(reportData) {
  return `
**削除操作手順:**

\`\`\`bash
# 1. GitHub API で削除（推奨）
curl -X DELETE \\
  -H "Authorization: token YOUR_GITHUB_TOKEN" \\
  https://api.github.com/repos/YOUR_OWNER/YOUR_REPO/releases/${reportData.release_id}
\`\`\`

2. または Netlify Function 経由:
   \`POST /api/github-upload?action=delete-release\`
   リクエストボディ: \`{"releaseId": ${reportData.release_id}}\`

3. Dashboard で確認後、削除実行
  `;
}

/**
 * Rate Limiting（簡易版）
 */
const reportRateLimit = new Map();

function checkReportRateLimit(clientIp) {
  const now = Date.now();
  const window = 3600 * 1000; // 1時間

  if (!reportRateLimit.has(clientIp)) {
    reportRateLimit.set(clientIp, { count: 0, resetTime: now + window });
  }

  const record = reportRateLimit.get(clientIp);

  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + window;
  }

  record.count++;

  // 1時間に10回まで
  return record.count <= 10;
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
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  // POST のみ許可
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Rate Limit チェック
  const clientIp = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
  if (!checkReportRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Report rate limit exceeded. Max 10 reports per hour per IP.',
      }),
    };
  }

  try {
    // リクエストボディをパース
    const body = JSON.parse(event.body || '{}');

    // バリデーション
    if (!body.file_url || !body.release_id || !body.reason) {
      throw new Error('Missing required fields: file_url, release_id, reason');
    }

    if (!REPORT_REASONS[body.reason]) {
      throw new Error(`Invalid reason: ${body.reason}`);
    }

    // 通報データを構築
    const reportData = {
      report_id: generateUUID(),
      file_url: body.file_url,
      release_id: body.release_id,
      reason: body.reason,
      additionalInfo: body.additionalInfo || '',
      reporter_ip: clientIp,
      timestamp: new Date().toISOString(),
    };

    console.log(`[Report] ${reportData.report_id} - ${reportData.reason}`);

    // Discord Embed を構築
    const embed = buildEmbed(reportData);
    const adminInstructions = buildAdminInstructions(reportData);

    // Discord Webhook ペイロード
    const discordPayload = {
      username: '🔔 Gofile Clone Reporter',
      avatar_url: 'https://github.githubassets.com/favicons/favicon.svg',
      embeds: [embed],
      content: `\`\`\`\n${adminInstructions}\n\`\`\``,
    };

    // Discord に送信
    const statusCode = await sendDiscordWebhook(discordPayload);

    console.log(`[Report] Sent to Discord - Status: ${statusCode}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        report_id: reportData.report_id,
        timestamp: reportData.timestamp,
        message: 'Report submitted successfully',
      }),
    };
  } catch (error) {
    console.error('[Report Error]', error.message);

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};