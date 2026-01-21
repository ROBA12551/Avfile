/**
 * js/simple-upload.js
 * 
 * Gofile 風ファイル共有サービス
 * - github.json で永続的に記録
 * - アップロード情報を GitHub に保存
 * - 過去のファイルに永遠にアクセス可能
 */

class SimpleUploadManager {
  constructor(config = {}) {
    this.config = {
      apiBaseUrl: 'https://api.github.com',
      requestTimeout: 30000,
      ...config,
    };
    this.jsonFileName = 'github.json';
  }

  /**
   * ファイルを Base64 に変換
   */
  async fileToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * UUID を生成
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 動画ファイルか判定
   */
  isVideoFile(file) {
    const videoMimes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
    ];
    return videoMimes.some(mime => file.type.startsWith(mime));
  }

  /**
   * ファイルをアップロード
   */
  async uploadFile(fileBlob, fileName, onProgress = () => {}) {
    try {
      // onProgress がない場合のデフォルト
      if (typeof onProgress !== 'function') {
        onProgress = (progress, message) => {
          console.log(`[${progress}%] ${message}`);
        };
      }

      const fileId = this.generateUUID();
      
      onProgress(2, '⏳ 準備中...');

      // 動画ファイルのみ圧縮
      let processedBlob = fileBlob;
      let wasCompressed = false;

      if (this.isVideoFile(fileBlob)) {
        console.log('🎥 動画ファイルを検出 - 720p 30fps に圧縮開始...');
        
        if (window.VideoCompressionEngine) {
          try {
            const compressor = new window.VideoCompressionEngine();
            processedBlob = await compressor.compress(fileBlob, (progress, message) => {
              // 圧縮進捗を反映（2-35%）
              onProgress(2 + (progress * 0.33), message);
            });
            
            wasCompressed = true;
            const originalMB = (fileBlob.size / 1024 / 1024).toFixed(1);
            const compressedMB = (processedBlob.size / 1024 / 1024).toFixed(1);
            const ratio = ((1 - processedBlob.size / fileBlob.size) * 100).toFixed(0);
            console.log(`📊 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);
          } catch (compressionError) {
            console.warn('⚠️ 圧縮失敗 - オリジナルでアップロード:', compressionError.message);
            wasCompressed = false;
          }
        } else {
          console.warn('⚠️ 圧縮エンジンが利用できません - オリジナルでアップロード');
        }
      }

      onProgress(40, '📤 Base64 エンコード中...');

      // Base64 にエンコード
      const base64 = await this.fileToBase64(processedBlob);

      onProgress(45, '☁️ GitHub にアップロード中...');

      // GitHub Releases にアップロード
      const uploadResult = await this.uploadToGitHubReleases(
        fileId, 
        fileName, 
        base64, 
        processedBlob.type,
        (progress, message) => {
          // GitHub アップロード進捗を反映（45-80%）
          onProgress(45 + (progress * 0.35), message);
        }
      );

      onProgress(82, '📝 アップロード情報を記録中...');

      // github.json にアップロード情報を保存
      await this.saveToGithubJson({
        fileId: fileId,
        fileName: fileName,
        downloadUrl: uploadResult.download_url,
        githubReleaseUrl: uploadResult.html_url,
        fileSize: processedBlob.size,
        compressed: wasCompressed,
        uploadedAt: new Date().toISOString(),
        releaseTag: uploadResult.release_tag,
        assetId: uploadResult.asset_id,
      });

      onProgress(90, '🔗 共有リンク生成中...');

      // 視聴可能な URL を生成
      const viewUrl = `${window.location.origin}/?id=${fileId}`;

      onProgress(98, '✨ 最後の処理中...');

      onProgress(100, '✅ アップロード完了！');

      console.log('✅ ファイルがアップロードされました');
      console.log('📺 視聴URL:', viewUrl);
      console.log('📥 ダウンロードURL:', uploadResult.download_url);

      return {
        success: true,
        fileName: fileName,
        fileId: fileId,
        viewUrl: viewUrl,
        downloadUrl: uploadResult.download_url,
        fileSize: processedBlob.size,
        githubUrl: uploadResult.html_url,
        uploadedAt: new Date().toISOString(),
        wasCompressed: wasCompressed,
      };
    } catch (error) {
      console.error('❌ アップロードエラー:', error.message);
      throw new Error(`ファイルアップロード失敗: ${error.message}`);
    }
  }

  /**
   * GitHub Releases にアップロード
   */
  async uploadToGitHubReleases(fileId, fileName, base64, fileType, onProgress) {
    try {
      const releaseTag = `file_${fileId}`;
      const fileExtension = this.getFileExtension(fileType);
      const assetFileName = `${fileName.substring(0, fileName.lastIndexOf('.') || fileName.length)}.${fileExtension}`;

      onProgress(10, '📝 Release を作成中...');

      // 1. Release を作成（ファイル名を含める）
      const createReleaseResponse = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-release',
          releaseTag: releaseTag,
          metadata: {
            title: `${fileName}`,
            description: `
File ID: ${fileId}
Original Name: ${fileName}
Type: ${fileType}
Uploaded: ${new Date().toISOString()}
            `.trim(),
          },
        }),
      });

      if (!createReleaseResponse.ok) {
        throw new Error(`Release 作成失敗: ${createReleaseResponse.statusText}`);
      }

      const createData = await createReleaseResponse.json();
      if (!createData.success) {
        throw new Error(createData.error || 'Release 作成失敗');
      }

      console.log('✅ Release 作成:', createData.data.release_id);

      onProgress(40, '📤 ファイルをアップロード中...');

      // 2. Asset（ファイル）をアップロード（オリジナルファイル名）
      const uploadAssetResponse = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload-asset',
          uploadUrl: createData.data.upload_url,
          fileName: assetFileName,
          fileBase64: base64,
        }),
      });

      if (!uploadAssetResponse.ok) {
        throw new Error(`ファイルアップロード失敗: ${uploadAssetResponse.statusText}`);
      }

      const uploadData = await uploadAssetResponse.json();
      if (!uploadData.success) {
        throw new Error(uploadData.error || 'ファイルアップロード失敗');
      }

      console.log('✅ ファイルアップロード:', uploadData.data.asset_id);

      onProgress(100, '✨ 完了');

      return {
        release_id: createData.data.release_id,
        release_tag: releaseTag,
        asset_id: uploadData.data.asset_id,
        download_url: uploadData.data.download_url,
        html_url: createData.data.html_url,
      };
    } catch (error) {
      console.error('❌ GitHub アップロードエラー:', error.message);
      throw error;
    }
  }

  /**
   * ファイルタイプから拡張子を取得
   */
  getFileExtension(fileType) {
    const extensionMap = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogg',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
    };
    return extensionMap[fileType] || 'bin';
  }

  /**
   * github.json を取得（存在しなければ自動作成）
   */
  async getGithubJson() {
    try {
      const response = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get-github-json',
        }),
      });

      if (!response.ok) {
        console.warn('⚠️ github.json が見つかりません - 新規作成します');
        return { files: [] };
      }

      const data = await response.json();
      if (!data.success) {
        console.warn('⚠️ github.json 取得失敗 - 新規作成します');
        return { files: [] };
      }

      return data.data;
    } catch (error) {
      console.warn('⚠️ github.json 取得エラー:', error.message);
      return { files: [] };
    }
  }

  /**
   * github.json に情報を追加・更新
   */
  async saveToGithubJson(fileInfo) {
    try {
      // 現在の github.json を取得
      const jsonData = await this.getGithubJson();

      // 新しいファイル情報を追加
      jsonData.files = jsonData.files || [];
      jsonData.files.push({
        fileId: fileInfo.fileId,
        fileName: fileInfo.fileName,
        downloadUrl: fileInfo.downloadUrl,
        githubReleaseUrl: fileInfo.githubReleaseUrl,
        fileSize: fileInfo.fileSize,
        compressed: fileInfo.compressed,
        uploadedAt: fileInfo.uploadedAt,
        releaseTag: fileInfo.releaseTag,
        assetId: fileInfo.assetId,
      });

      // 最後に更新した時刻
      jsonData.lastUpdated = new Date().toISOString();

      // github.json を GitHub に保存
      const saveResponse = await fetch('/.netlify/functions/github-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-github-json',
          jsonData: jsonData,
        }),
      });

      if (!saveResponse.ok) {
        throw new Error(`github.json 保存失敗: ${saveResponse.statusText}`);
      }

      const saveData = await saveResponse.json();
      if (!saveData.success) {
        throw new Error(saveData.error || 'github.json 保存失敗');
      }

      console.log('✅ github.json に記録しました');
    } catch (error) {
      console.error('❌ github.json 保存エラー:', error.message);
      throw error;
    }
  }

  /**
   * github.json からすべてのファイル情報を取得
   */
  async getAllFiles() {
    try {
      const jsonData = await this.getGithubJson();
      return jsonData.files || [];
    } catch (error) {
      console.error('❌ エラー:', error.message);
      return [];
    }
  }

  /**
   * github.json から特定のファイル情報を取得
   */
  async getFileInfo(fileId) {
    try {
      const files = await this.getAllFiles();
      return files.find(f => f.fileId === fileId) || null;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      return null;
    }
  }

  /**
   * 共有リンクをクリップボードにコピー
   */
  copyToClipboard(text) {
    return new Promise((resolve, reject) => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text)
          .then(() => {
            console.log('✅ コピー完了');
            resolve();
          })
          .catch(reject);
      } else {
        // フォールバック
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        console.log('✅ コピー完了');
        resolve();
      }
    });
  }
}

// グローバルエクスポート
window.SimpleUploadManager = SimpleUploadManager;