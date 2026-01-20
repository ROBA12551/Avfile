/**
 * netlify-api-client.js
 * 
 * Netlify Functions を通じて Backend API と通信するクライアント
 * クライアント側の compress.js との連携ポイント
 * 
 * 使用:
 * const client = new NetlifyAPIClient();
 * const result = await client.uploadFile(compressedBlob, metadata);
 */

class NetlifyAPIClient {
  constructor(baseUrl = '/.netlify/functions') {
    this.baseUrl = baseUrl;
    this.requestTimeout = 30000; // 30秒
  }

  /**
   * API リクエストを実行
   * @param {string} endpoint - Function エンドポイント名
   * @param {Object} options - リクエストオプション
   * @returns {Promise<Object>}
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/${endpoint}`;
    const timeout = options.timeout || this.requestTimeout;

    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    if (options.body) {
      if (typeof options.body === 'object') {
        fetchOptions.body = JSON.stringify(options.body);
      } else {
        fetchOptions.body = options.body;
      }
    }

    console.log(`[API] ${fetchOptions.method} ${url}`);

    try {
      // タイムアウト付き fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout (${timeout}ms)`);
      }
      throw error;
    }
  }

  /**
   * Release を作成
   * @param {string} releaseTag - タグ名
   * @param {Object} metadata - メタデータ
   * @returns {Promise<Object>}
   */
  async createRelease(releaseTag, metadata) {
    console.log('📝 Creating GitHub release...');

    const response = await this.request('github-upload', {
      method: 'POST',
      body: {
        action: 'create-release',
        releaseTag: releaseTag,
        metadata: metadata,
      },
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to create release');
    }

    console.log('✅ Release created:', response.data.release_id);
    return response.data;
  }

  /**
   * ファイルをアップロード
   * @param {Blob} fileBlob - 圧縮済みファイル
   * @param {string} uploadUrl - Release upload_url
   * @param {string} fileName - ファイル名
   * @param {Function} onProgress - 進捗コールバック
   * @returns {Promise<Object>}
   */
  async uploadAsset(fileBlob, uploadUrl, fileName, onProgress = () => {}) {
    console.log(`📤 Uploading asset: ${fileName}`);

    // Blob を Base64 に変換
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const base64 = reader.result.split(',')[1];

          onProgress(50, 'Sending to server...');

          const response = await this.request('github-upload', {
            method: 'POST',
            body: {
              action: 'upload-asset',
              fileBase64: base64,
              uploadUrl: uploadUrl,
              fileName: fileName,
            },
          });

          if (!response.success) {
            throw new Error(response.error || 'Failed to upload asset');
          }

          onProgress(100, 'Upload complete');
          console.log('✅ Asset uploaded:', response.data.asset_id);

          resolve(response.data);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsDataURL(fileBlob);
    });
  }

  /**
   * ファイル情報を取得
   * @param {number} releaseId - Release ID
   * @returns {Promise<Object>}
   */
  async getFileInfo(releaseId) {
    console.log(`📥 Getting file info: ${releaseId}`);

    const response = await this.request('file-info', {
      method: 'GET',
    }, `?releaseId=${releaseId}`);

    if (!response.success) {
      throw new Error(response.error || 'Failed to get file info');
    }

    return response.data;
  }

  /**
   * Release を削除（Admin用）
   * @param {number} releaseId - Release ID
   * @returns {Promise<boolean>}
   */
  async deleteRelease(releaseId) {
    console.log(`🗑️ Deleting release: ${releaseId}`);

    const response = await this.request('github-upload', {
      method: 'POST',
      body: {
        action: 'delete-release',
        releaseId: releaseId,
      },
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to delete release');
    }

    console.log('✅ Release deleted');
    return true;
  }

  /**
   * 通報を送信
   * @param {Object} reportData - 通報データ
   * @returns {Promise<Object>}
   */
  async submitReport(reportData) {
    console.log('🚨 Submitting report...');

    const response = await this.request('report-submit', {
      method: 'POST',
      body: reportData,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit report');
    }

    console.log('✅ Report submitted:', response.data.report_id);
    return response.data;
  }

  /**
   * 最新リリース一覧を取得
   * @param {number} limit - 取得件数
   * @returns {Promise<Array>}
   */
  async getLatestReleases(limit = 10) {
    console.log('📊 Getting latest releases...');

    const response = await this.request('file-info', {
      method: 'GET',
    }, `?action=latest-releases&limit=${limit}`);

    if (!response.success) {
      throw new Error(response.error || 'Failed to get releases');
    }

    return response.data;
  }

  /**
   * 一括アップロード（Release + Asset）
   * @param {Blob} fileBlob - 圧縮済みファイル
   * @param {Object} metadata - メタデータ
   * @param {Function} onProgress - 進捗コールバック
   * @returns {Promise<Object>}
   */
  async uploadWithMetadata(fileBlob, metadata, onProgress = () => {}) {
    try {
      onProgress(0, 'Creating release...');

      // 1. Release を作成
      const release = await this.createRelease(
        `video_${metadata.file_id}`,
        metadata
      );

      onProgress(25, 'Uploading file...');

      // 2. Asset をアップロード
      const asset = await this.uploadAsset(
        fileBlob,
        release.upload_url,
        `${metadata.file_id}.mp4`,
        (percent, message) => {
          const overallPercent = 25 + percent * 0.75;
          onProgress(overallPercent, message);
        }
      );

      onProgress(100, 'Upload complete!');

      return {
        release_id: release.release_id,
        asset_id: asset.asset_id,
        asset_url: asset.download_url,
        release_url: release.html_url,
      };
    } catch (error) {
      console.error('❌ Upload failed:', error);
      throw error;
    }
  }

  /**
   * エラーハンドリング用ユーティリティ
   * @param {Error} error - エラーオブジェクト
   * @returns {string} - ユーザーフレンドリーなメッセージ
   */
  static getErrorMessage(error) {
    const message = error.message || '';

    if (message.includes('Rate limit')) {
      return 'リクエストが多すぎます。少し待ってからお試しください。';
    }

    if (message.includes('timeout')) {
      return 'リクエストがタイムアウトしました。接続を確認してください。';
    }

    if (message.includes('401') || message.includes('403')) {
      return '認証エラーです。GitHub トークンを確認してください。';
    }

    if (message.includes('Network')) {
      return 'ネットワークエラーです。接続を確認してください。';
    }

    return error.message || '不明なエラーが発生しました。';
  }
}

// グローバルエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NetlifyAPIClient;
}

window.NetlifyAPIClient = NetlifyAPIClient;