

class GitHubUploadManagerNetlify {
  constructor(config = {}) {
    // Netlify Functions のベース URL（自動検出）
    this.apiBaseUrl = config.apiBaseUrl || '/.netlify/functions';
    this.requestTimeout = config.requestTimeout || 30000;

    // キャッシュ
    this.cache = new Map();
    this.cacheTTL = 3600 * 1000; // 1時間
  }

  /**
   * Netlify Functions にリクエストを送信
   * @param {string} functionName - Function 名
   * @param {string} method - HTTP メソッド
   * @param {Object} body - リクエストボディ
   * @returns {Promise<Object>}
   */
  async callFunction(functionName, method = 'POST', body = null) {
    const url = `${this.apiBaseUrl}/${functionName}`;

    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    console.log(`[Netlify] ${method} ${functionName}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout (${this.requestTimeout}ms)`);
      }
      throw error;
    }
  }

  /**
   * キャッシュ付きでリクエストを実行
   * @param {string} key - キャッシュキー
   * @param {Function} fn - 実行関数
   * @returns {Promise}
   */
  async withCache(key, fn) {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && now < cached.expiresAt) {
      console.log(`[Cache HIT] ${key}`);
      return cached.value;
    }

    console.log(`[Cache MISS] ${key}`);
    const value = await fn();

    this.cache.set(key, {
      value: value,
      expiresAt: now + this.cacheTTL,
    });

    return value;
  }

  /**
   * Release を作成
   * @param {string} releaseTag - タグ名
   * @param {Object} metadata - メタデータ
   * @returns {Promise<Object>}
   */
  async createRelease(releaseTag, metadata) {
    console.log('📝 Creating release:', releaseTag);

    const response = await this.callFunction('github-upload', 'POST', {
      action: 'create-release',
      releaseTag: releaseTag,
      metadata: metadata,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to create release');
    }

    console.log('✅ Release created:', response.data.release_id);
    return response.data;
  }

  /**
   * Asset をアップロード
   * @param {string} uploadUrl - GitHub upload_url
   * @param {Blob} fileBlob - ファイル
   * @param {string} fileName - ファイル名
   * @param {Function} onProgress - 進捗コールバック
   * @returns {Promise<Object>}
   */
  async uploadAsset(uploadUrl, fileBlob, fileName, onProgress = () => {}) {
    console.log(`📤 Uploading asset: ${fileName}`);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          onProgress(50, 'Sending to server...');

          // Base64 に変換
          const base64 = reader.result.split(',')[1];

          const response = await this.callFunction('github-upload', 'POST', {
            action: 'upload-asset',
            fileBase64: base64,
            uploadUrl: uploadUrl,
            fileName: fileName,
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
    const cacheKey = `file:${releaseId}`;

    return this.withCache(cacheKey, async () => {
      console.log(`📥 Getting file info: ${releaseId}`);

      const response = await fetch(
        `${this.apiBaseUrl}/file-info?action=get-release&releaseId=${releaseId}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get file info');
      }

      return data.data;
    });
  }

  /**
   * Release を削除（Admin用）
   * @param {number} releaseId - Release ID
   * @returns {Promise<boolean>}
   */
  async deleteRelease(releaseId) {
    console.log(`🗑️ Deleting release: ${releaseId}`);

    const response = await this.callFunction('github-upload', 'POST', {
      action: 'delete-release',
      releaseId: releaseId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to delete release');
    }

    // キャッシュをクリア
    this.cache.delete(`file:${releaseId}`);

    console.log('✅ Release deleted');
    return true;
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
      onProgress(5, 'Creating release...');

      // 1. Release を作成
      const release = await this.createRelease(
        `video_${metadata.file_id}`,
        metadata
      );

      onProgress(25, 'Uploading file to server...');

      // 2. Asset をアップロード
      const asset = await this.uploadAsset(
        release.upload_url,
        fileBlob,
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
        file_name: asset.name,
      };
    } catch (error) {
      console.error('❌ Upload failed:', error);
      throw error;
    }
  }

  /**
   * 最新リリース一覧を取得
   * @param {number} limit - 取得件数
   * @returns {Promise<Array>}
   */
  async getLatestReleases(limit = 10) {
    const cacheKey = `releases:latest:${limit}`;

    return this.withCache(cacheKey, async () => {
      console.log(`📊 Getting latest releases (limit: ${limit})`);

      const response = await fetch(
        `${this.apiBaseUrl}/file-info?action=latest-releases&limit=${limit}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get releases');
      }

      return data.data;
    });
  }

  /**
   * エラーを人間が読める形に変換
   * @param {Error} error
   * @returns {string}
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
      return 'サーバー認証エラーです。後で再度お試しください。';
    }

    if (message.includes('Network')) {
      return 'ネットワークエラーです。接続を確認してください。';
    }

    return error.message || '不明なエラーが発生しました。';
  }

  /**
   * キャッシュをクリア
   * @param {string} pattern - パターン（オプション）
   */
  clearCache(pattern = null) {
    if (!pattern) {
      this.cache.clear();
      console.log('[Cache] Cleared all');
      return;
    }

    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }

    console.log(`[Cache] Cleared pattern: ${pattern}`);
  }
}

// グローバルエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GitHubUploadManagerNetlify;
}

window.GitHubUploadManagerNetlify = GitHubUploadManagerNetlify;