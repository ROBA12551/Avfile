/**
 * js/simple-upload.js
 * 
 * IndexedDB ベースのアップロード処理
 * localStorage クォータ問題を解決
 */

class SimpleUploadManager {
  constructor(config = {}) {
    this.config = {
      apiBaseUrl: 'https://api.github.com',
      requestTimeout: 30000,
      ...config,
    };
    this.dbName = 'AvfileDB';
    this.storeName = 'files';
    this.metaStoreName = 'metadata';
  }

  /**
   * IndexedDB を初期化
   */
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => {
        console.error('❌ IndexedDB open error:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        console.log('✅ IndexedDB opened');
        resolve(request.result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // ファイル保存用のオブジェクトストア
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
          console.log('✅ Created files store');
        }
        
        // メタデータ保存用のオブジェクトストア
        if (!db.objectStoreNames.contains(this.metaStoreName)) {
          db.createObjectStore(this.metaStoreName, { keyPath: 'id' });
          console.log('✅ Created metadata store');
        }
      };
    });
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
   * IndexedDB にファイルを保存
   */
  async saveFileToIndexedDB(fileInfo) {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.add(fileInfo);
        
        request.onerror = () => {
          console.error('❌ Error saving file:', request.error);
          reject(request.error);
        };
        
        request.onsuccess = () => {
          console.log('✅ File saved to IndexedDB:', fileInfo.id);
          resolve(fileInfo.id);
        };
      });
    } catch (error) {
      console.error('❌ IndexedDB save error:', error);
      throw error;
    }
  }

  /**
   * IndexedDB からファイルを取得
   */
  async getFileFromIndexedDB(fileId) {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.get(fileId);
        
        request.onerror = () => {
          console.error('❌ Error retrieving file:', request.error);
          reject(request.error);
        };
        
        request.onsuccess = () => {
          const fileData = request.result;
          if (fileData) {
            console.log('✅ File retrieved from IndexedDB:', fileId);
          } else {
            console.warn('⚠️ File not found:', fileId);
          }
          resolve(fileData);
        };
      });
    } catch (error) {
      console.error('❌ IndexedDB retrieval error:', error);
      return null;
    }
  }

  /**
   * メタデータを localStorage に保存（小サイズなので OK）
   */
  saveMetadata(fileId, fileName, fileSize, uploadedAt) {
    try {
      let uploads = JSON.parse(localStorage.getItem('avfile_uploads') || '[]');
      uploads.push({
        id: fileId,
        fileName: fileName,
        fileSize: fileSize,
        uploadedAt: uploadedAt,
      });
      // 最新 100 件のみ保持
      uploads = uploads.slice(-100);
      localStorage.setItem('avfile_uploads', JSON.stringify(uploads));
      console.log('✅ Metadata saved to localStorage');
    } catch (error) {
      console.warn('⚠️ Metadata save warning:', error.message);
      // メタデータ保存失敗は警告のみ（ファイル自体は保存済み）
    }
  }

  /**
   * デモモード - IndexedDB にアップロード
   */
  async createDemoUpload(fileBlob, fileName, onProgress = () => {}) {
    try {
      console.log('📁 Demo mode: Uploading to IndexedDB...');
      
      onProgress(20, 'Reading file...');

      // UUID を生成
      const fileId = this.generateUUID();
      
      // Base64 にエンコード
      onProgress(40, 'Encoding to Base64...');
      const base64 = await this.fileToBase64(fileBlob);
      console.log(`📊 File size: ${fileBlob.size} bytes, Base64 size: ${base64.length} bytes`);

      onProgress(60, 'Saving to IndexedDB...');

      // ファイル情報を作成
      const fileInfo = {
        id: fileId,
        name: fileName,
        size: fileBlob.size,
        type: fileBlob.type,
        uploadedAt: new Date().toISOString(),
        data: base64,
      };

      // IndexedDB に保存（容量無制限）
      await this.saveFileToIndexedDB(fileInfo);

      onProgress(80, 'Saving metadata...');

      // メタデータを localStorage に保存
      this.saveMetadata(fileId, fileName, fileBlob.size, fileInfo.uploadedAt);

      onProgress(100, 'Upload complete!');

      console.log('✅ File uploaded successfully');

      return {
        success: true,
        fileName: fileName,
        downloadUrl: `${window.location.origin}/?id=${fileId}`,
        fileSize: fileBlob.size,
        fileId: fileId,
      };
    } catch (error) {
      console.error('❌ Upload error:', error.message);
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  /**
   * GitHub に直接アップロード（オプション）
   */
  async uploadToGitHub(fileBlob, fileName, onProgress = () => {}) {
    try {
      let token = localStorage.getItem('github_token');
      
      if (!token) {
        console.warn('⚠️ No GitHub token found. Using demo mode.');
        return this.createDemoUpload(fileBlob, fileName, onProgress);
      }

      const owner = localStorage.getItem('github_owner') || 'avfile-demo';
      const repo = localStorage.getItem('github_repo') || 'avfile-storage';

      console.log(`📤 Uploading to ${owner}/${repo}...`);
      onProgress(50, 'Uploading file...');

      const base64 = await this.fileToBase64(fileBlob);
      
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
      
      onProgress(100, 'Upload complete!');

      return {
        success: true,
        fileName: fileName,
        downloadUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/${fileName}`,
        fileSize: fileBlob.size,
      };
    } catch (error) {
      console.error('❌ Upload error:', error.message);
      throw error;
    }
  }

  /**
   * ファイルデータを取得
   */
  async getFileData(fileId) {
    try {
      const fileData = await this.getFileFromIndexedDB(fileId);
      return fileData;
    } catch (error) {
      console.error('❌ Error getting file:', error.message);
      return null;
    }
  }
}

// グローバルエクスポート
window.SimpleUploadManager = SimpleUploadManager;