/**
 * js/storage.js
 * 
 * localStorage を使用したユーザーデータ管理
 * - ユーザー ID（UUID）生成・管理
 * - アップロード履歴管理
 * - 統計情報管理
 * - ローカルストレージのエクスポート・インポート
 * 
 * 使用方法:
 * const storage = new StorageManager();
 * storage.addUpload({ file_id, title, size, ... });
 * const uploads = storage.getActiveUploads();
 * const stats = storage.getStatistics();
 */

class StorageManager {
  constructor(config = {}) {
    this.config = {
      storageKey: 'gofile_clone',
      maxStorageSize: 100 * 1024 * 1024, // 100MB
      retentionDays: 30,
      ...config,
    };

    this.storageKey = this.config.storageKey;
    this.initStorage();
  }

  /**
   * ストレージを初期化
   */
  initStorage() {
    try {
      const data = this.getStorageData();

      if (!data) {
        this.saveStorageData({
          version: '1.0.0',
          user_id: this.generateUUID(),
          uploads: [],
          created_at: new Date().toISOString(),
        });

        console.log('✅ Storage initialized');
      } else {
        console.log('✅ Storage loaded');
      }
    } catch (error) {
      console.error('❌ Storage initialization failed:', error);
    }
  }

  /**
   * ストレージデータを取得
   * @returns {Object|null}
   */
  getStorageData() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('❌ Error reading storage:', error);
      return null;
    }
  }

  /**
   * ストレージデータを保存
   * @param {Object} data
   */
  saveStorageData(data) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('❌ Error saving storage:', error);

      // ストレージ満杯の場合
      if (error.name === 'QuotaExceededError') {
        console.warn('⚠️ Storage quota exceeded. Cleaning old data...');
        this.cleanOldData();
        try {
          localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (retryError) {
          console.error('❌ Failed to save even after cleanup:', retryError);
        }
      }
    }
  }

  /**
   * UUID を生成
   * @returns {string}
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * ユーザー ID を取得
   * @returns {string}
   */
  getUserId() {
    const data = this.getStorageData();
    return data?.user_id || null;
  }

  /**
   * アップロード情報を追加
   * @param {Object} upload - アップロード情報
   */
  addUpload(upload) {
    try {
      const data = this.getStorageData();

      if (!data) {
        console.error('❌ Storage not initialized');
        return;
      }

      const uploadData = {
        id: this.generateUUID(),
        file_id: upload.file_id,
        release_id: upload.release_id,
        title: upload.title || 'Untitled',
        original_filename: upload.original_filename,
        original_size: upload.original_size,
        compressed_size: upload.compressed_size,
        compression_ratio: upload.compression_ratio || 1.0,
        asset_url: upload.asset_url,
        download_url: upload.download_url,
        uploaded_at: new Date().toISOString(),
        view_count: 0,
        download_count: 0,
        is_deleted: false,
      };

      data.uploads.push(uploadData);
      this.saveStorageData(data);

      console.log(`✅ Upload added: ${uploadData.title}`);
      return uploadData;
    } catch (error) {
      console.error('❌ Error adding upload:', error);
    }
  }

  /**
   * アクティブなアップロード（削除されていないもの）を取得
   * @returns {Array}
   */
  getActiveUploads() {
    try {
      const data = this.getStorageData();

      if (!data) {
        return [];
      }

      return (data.uploads || [])
        .filter((upload) => !upload.is_deleted)
        .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    } catch (error) {
      console.error('❌ Error getting uploads:', error);
      return [];
    }
  }

  /**
   * 特定のアップロード情報を取得
   * @param {string} uploadId
   * @returns {Object|null}
   */
  getUpload(uploadId) {
    try {
      const data = this.getStorageData();

      if (!data) {
        return null;
      }

      return (data.uploads || []).find((upload) => upload.id === uploadId) || null;
    } catch (error) {
      console.error('❌ Error getting upload:', error);
      return null;
    }
  }

  /**
   * Release ID でアップロード情報を検索
   * @param {string} releaseId
   * @returns {Object|null}
   */
  getUploadByReleaseId(releaseId) {
    try {
      const data = this.getStorageData();

      if (!data) {
        return null;
      }

      return (data.uploads || []).find(
        (upload) => upload.release_id === releaseId && !upload.is_deleted
      ) || null;
    } catch (error) {
      console.error('❌ Error getting upload by release ID:', error);
      return null;
    }
  }

  /**
   * 再生回数を増加
   * @param {string} fileId
   */
  incrementViewCount(fileId) {
    try {
      const data = this.getStorageData();

      if (!data) {
        return;
      }

      const upload = data.uploads.find((u) => u.file_id === fileId);

      if (upload) {
        upload.view_count = (upload.view_count || 0) + 1;
        this.saveStorageData(data);
      }
    } catch (error) {
      console.error('❌ Error incrementing view count:', error);
    }
  }

  /**
   * ダウンロード回数を増加
   * @param {string} fileId
   */
  incrementDownloadCount(fileId) {
    try {
      const data = this.getStorageData();

      if (!data) {
        return;
      }

      const upload = data.uploads.find((u) => u.file_id === fileId);

      if (upload) {
        upload.download_count = (upload.download_count || 0) + 1;
        this.saveStorageData(data);
      }
    } catch (error) {
      console.error('❌ Error incrementing download count:', error);
    }
  }

  /**
   * アップロードを削除（論理削除）
   * @param {string} uploadId
   */
  deleteUpload(uploadId) {
    try {
      const data = this.getStorageData();

      if (!data) {
        return;
      }

      const upload = data.uploads.find((u) => u.id === uploadId);

      if (upload) {
        upload.is_deleted = true;
        upload.deleted_at = new Date().toISOString();
        this.saveStorageData(data);

        console.log(`✅ Upload deleted: ${upload.title}`);
      }
    } catch (error) {
      console.error('❌ Error deleting upload:', error);
    }
  }

  /**
   * 統計情報を取得
   * @returns {Object}
   */
  getStatistics() {
    try {
      const data = this.getStorageData();
      const uploads = this.getActiveUploads();

      if (!data) {
        return {
          user_id: null,
          active_uploads: 0,
          total_storage_used: 0,
          total_views: 0,
          total_downloads: 0,
        };
      }

      const totalViewCount = uploads.reduce(
        (sum, upload) => sum + (upload.view_count || 0),
        0
      );
      const totalDownloadCount = uploads.reduce(
        (sum, upload) => sum + (upload.download_count || 0),
        0
      );
      const totalStorageUsed = uploads.reduce(
        (sum, upload) => sum + (upload.compressed_size || 0),
        0
      );

      return {
        user_id: data.user_id,
        active_uploads: uploads.length,
        total_storage_used: totalStorageUsed,
        total_views: totalViewCount,
        total_downloads: totalDownloadCount,
        average_compression_ratio:
          uploads.length > 0
            ? (
                uploads.reduce(
                  (sum, upload) => sum + (upload.compression_ratio || 1.0),
                  0
                ) / uploads.length
              ).toFixed(2)
            : 1.0,
      };
    } catch (error) {
      console.error('❌ Error getting statistics:', error);
      return {};
    }
  }

  /**
   * 古いデータをクリア（保持期間超過）
   */
  cleanOldData() {
    try {
      const data = this.getStorageData();

      if (!data) {
        return;
      }

      const now = new Date();
      const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;

      data.uploads = data.uploads.filter((upload) => {
        if (upload.is_deleted) {
          const deletedAt = new Date(upload.deleted_at);
          const ageDays = (now - deletedAt) / (24 * 60 * 60 * 1000);

          // 削除後30日経過したものは完全削除
          if (ageDays > this.config.retentionDays) {
            console.log(`🗑️ Purging old upload: ${upload.title}`);
            return false;
          }
        }

        return true;
      });

      this.saveStorageData(data);
      console.log('✅ Old data cleaned');
    } catch (error) {
      console.error('❌ Error cleaning old data:', error);
    }
  }

  /**
   * すべてのデータをクリア
   */
  clearAll() {
    try {
      localStorage.removeItem(this.storageKey);
      console.log('🗑️ All storage cleared');
      this.initStorage();
    } catch (error) {
      console.error('❌ Error clearing storage:', error);
    }
  }

  /**
   * ストレージ使用量を計算
   * @returns {number} - バイト数
   */
  getStorageUsage() {
    try {
      const dataStr = localStorage.getItem(this.storageKey);
      return dataStr ? new Blob([dataStr]).size : 0;
    } catch (error) {
      console.error('❌ Error calculating storage usage:', error);
      return 0;
    }
  }

  /**
   * ストレージ使用率を取得（パーセント）
   * @returns {number}
   */
  getStorageUsagePercent() {
    const usage = this.getStorageUsage();
    return (usage / this.config.maxStorageSize) * 100;
  }

  /**
   * ストレージデータをエクスポート
   * @returns {string} - JSON 文字列
   */
  exportData() {
    try {
      const data = this.getStorageData();
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('❌ Error exporting data:', error);
      return null;
    }
  }

  /**
   * ストレージデータをインポート
   * @param {string} jsonStr - JSON 文字列
   */
  importData(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);

      if (!data.user_id || !data.uploads) {
        throw new Error('Invalid import data format');
      }

      this.saveStorageData(data);
      console.log('✅ Data imported successfully');
    } catch (error) {
      console.error('❌ Error importing data:', error);
      throw error;
    }
  }

  /**
   * ダウンロード用のバックアップファイルを生成
   */
  downloadBackup() {
    try {
      const data = this.exportData();

      if (!data) {
        throw new Error('Failed to export data');
      }

      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = `gofile-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('✅ Backup downloaded');
    } catch (error) {
      console.error('❌ Error downloading backup:', error);
    }
  }

  /**
   * ログを出力（デバッグ用）
   */
  printDebugInfo() {
    const data = this.getStorageData();
    const stats = this.getStatistics();
    const usage = this.getStorageUsagePercent();

    console.group('Storage Debug Info');
    console.log('User ID:', stats.user_id);
    console.log('Active Uploads:', stats.active_uploads);
    console.log('Total Storage Used:', (stats.total_storage_used / 1024 / 1024).toFixed(2), 'MB');
    console.log('Storage Usage:', usage.toFixed(2) + '%');
    console.log('Total Views:', stats.total_views);
    console.log('Total Downloads:', stats.total_downloads);
    console.log('All Data:', data);
    console.groupEnd();
  }
}

// グローバルエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}

window.StorageManager = StorageManager;