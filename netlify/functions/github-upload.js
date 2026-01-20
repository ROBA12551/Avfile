/**
 * js/simple-upload.js
 * 
 * シンプルなアップロード処理
 * GitHub Releases へ直接アップロード（Netlify Functions 不要）
 */

class SimpleUploadManager {
  constructor(config = {}) {
    this.config = {
      apiBaseUrl: 'https://api.github.com',
      requestTimeout: 30000,
      ...config,
    };
  }

  /**
   * GitHub に直接アップロード
   */
  async uploadToGitHub(fileBlob, fileName, onProgress = () => {}) {
    try {
      // GitHub Token は環境変数から取得（ローカル開発用）
      let token = localStorage.getItem('github_token');
      
      if (!token) {
        // デモモード - ローカルストレージに保存
        console.warn('⚠️ No GitHub token found. Using demo mode.');
        return this.createDemoUpload(fileBlob, fileName, onProgress);
      }

      const owner = localStorage.getItem('github_owner') || 'avfile-demo';
      const repo = localStorage.getItem('github_repo') || 'avfile-storage';

      console.log(`📤 Uploading to ${owner}/${repo}...`);
      onProgress(50, 'Uploading file...');

      // Base64 にエンコード
      const base64 = await this.fileToBase64(fileBlob);
      
      // GitHub API でアップロード
      const response = await fetch(
        `${this.config.apiBaseUrl}/repos/${owner}/${repo}/contents/${fileName}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `Upload: ${fileName}`,
            content: base64,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API Error (${response.status}): ${response.statusText}`);
      }

      const data = await response.json();
      
      onProgress(90, 'Creating download link...');

      // ダウンロードリンクを生成
      const downloadUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${fileName}`;
      
      onProgress(100, 'Upload complete!');

      return {
        success: true,
        fileName: fileName,
        downloadUrl: downloadUrl,
        fileSize: fileBlob.size,
      };
    } catch (error) {
      console.error('❌ Upload error:', error.message);
      throw error;
    }
  }

  /**
   * デモモード - ローカルストレージにアップロード
   */
  async createDemoUpload(fileBlob, fileName, onProgress = () => {}) {
    try {
      console.log('📁 Demo mode: Saving to localStorage...');
      
      onProgress(50, 'Processing file...');

      // UUID を生成
      const fileId = this.generateUUID();
      
      // Base64 にエンコード
      const base64 = await this.fileToBase64(fileBlob);

      onProgress(80, 'Saving file info...');

      // ローカルストレージに保存
      const fileInfo = {
        id: fileId,
        name: fileName,
        size: fileBlob.size,
        type: fileBlob.type,
        uploadedAt: new Date().toISOString(),
        data: base64,
      };

      // アップロード情報を保存
      let uploads = JSON.parse(localStorage.getItem('avfile_uploads') || '[]');
      uploads.push({
        id: fileId,
        fileName: fileName,
        fileSize: fileBlob.size,
        uploadedAt: fileInfo.uploadedAt,
        downloadUrl: `/view/${fileId}`,
      });
      localStorage.setItem('avfile_uploads', JSON.stringify(uploads));

      // ファイルデータを保存
      localStorage.setItem(`avfile_file_${fileId}`, JSON.stringify(fileInfo));

      onProgress(100, 'Upload complete!');

      console.log('✅ File saved to localStorage');

      return {
        success: true,
        fileName: fileName,
        downloadUrl: `${window.location.origin}/?id=${fileId}`,
        fileSize: fileBlob.size,
        fileId: fileId,
      };
    } catch (error) {
      console.error('❌ Demo upload error:', error.message);
      throw error;
    }
  }

  /**
   * ファイルを Base64 に変換
   */
  async fileToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Data URL から Base64 部分を抽出
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
   * アップロードしたファイルを取得
   */
  getFileData(fileId) {
    try {
      const fileInfo = JSON.parse(localStorage.getItem(`avfile_file_${fileId}`));
      return fileInfo;
    } catch (error) {
      console.error('❌ Error getting file:', error.message);
      return null;
    }
  }
}

// グローバルエクスポート
window.SimpleUploadManager = SimpleUploadManager;