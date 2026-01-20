/**
 * js/viewer-embedded.js
 * 
 * ビューアー機能をメインアプリに統合
 * URL パラメータで自動的にビューアーモードに切り替え
 */

class EmbeddedViewer {
  constructor() {
    this.fileId = null;
    this.fileData = null;
    this.isViewing = false;
  }

  /**
   * URL からファイル ID を取得
   */
  getFileIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id') || this.getFileIdFromPath();
  }

  /**
   * パスからファイル ID を取得
   */
  getFileIdFromPath() {
    const pathMatch = window.location.pathname.match(/\/view\/(.+)$/);
    return pathMatch ? pathMatch[1] : null;
  }

  /**
   * ビューアーモードで起動
   */
  async initViewer(fileId, uploadManager) {
    try {
      console.log('📺 Initializing viewer mode...');
      this.fileId = fileId;

      // localStorage からファイルを取得
      const fileData = uploadManager.getFileData(fileId);

      if (!fileData) {
        console.error('❌ File not found:', fileId);
        this.showViewerError('File not found. It may have been deleted.');
        return false;
      }

      this.fileData = fileData;
      this.isViewing = true;

      // UI を準備
      this.setupViewerUI(fileData);
      console.log('✅ Viewer mode active');
      return true;

    } catch (error) {
      console.error('❌ Error initializing viewer:', error);
      this.showViewerError(error.message);
      return false;
    }
  }

  /**
   * ビューアー UI をセットアップ
   */
  setupViewerUI(fileData) {
    // メインコンテンツを非表示
    const mainContent = document.getElementById('mainContent');
    if (mainContent) mainContent.style.display = 'none';

    // ビューアーコンテナを作成
    let viewerContainer = document.getElementById('viewerContainer');
    if (!viewerContainer) {
      viewerContainer = document.createElement('div');
      viewerContainer.id = 'viewerContainer';
      document.body.appendChild(viewerContainer);
    }

    // ビューアーコンテンツを生成
    const isVideo = fileData.type?.startsWith('video/');
    const isImage = fileData.type?.startsWith('image/');

    let content = `
      <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: #1a1a2e; z-index: 1000; display: flex; flex-direction: column;">
        <!-- Header -->
        <div style="background: #0f0f1e; padding: 1rem; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <a href="/" style="color: #FFD700; text-decoration: none; font-weight: bold; font-size: 1.2rem;">← Back</a>
          </div>
          <h2 style="color: white; margin: 0; flex: 1; text-align: center;">${this.escapeHtml(fileData.name || 'File')}</h2>
          <button id="downloadViewerBtn" style="background: #667eea; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Download</button>
        </div>

        <!-- Content -->
        <div style="flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 2rem;">
    `;

    if (isVideo && fileData.data) {
      content += `
        <video style="max-width: 90%; max-height: 90%; object-fit: contain;" controls>
          <source src="data:${fileData.type};base64,${fileData.data}" type="${fileData.type}" />
          Your browser does not support the video tag.
        </video>
      `;
    } else if (isImage && fileData.data) {
      content += `
        <img src="data:${fileData.type};base64,${fileData.data}" style="max-width: 90%; max-height: 90%; object-fit: contain;" alt="${this.escapeHtml(fileData.name)}" />
      `;
    } else {
      content += `
        <div style="text-align: center; color: white;">
          <h3>📄 ${this.escapeHtml(fileData.name)}</h3>
          <p>Size: ${(fileData.size / 1024 / 1024).toFixed(1)} MB</p>
          <button id="downloadViewerBtn" style="background: #667eea; color: white; border: none; padding: 1rem 2rem; border-radius: 4px; cursor: pointer; font-size: 1rem; margin-top: 1rem;">Download File</button>
        </div>
      `;
    }

    content += `
        </div>

        <!-- Info -->
        <div style="background: #0f0f1e; padding: 1rem; border-top: 1px solid #333; color: #ccc; font-size: 0.9rem;">
          <p>Size: ${(fileData.size / 1024 / 1024).toFixed(1)} MB | Type: ${fileData.type || 'Unknown'}</p>
        </div>
      </div>
    `;

    viewerContainer.innerHTML = content;

    // ダウンロードボタンのイベントリスナー
    document.getElementById('downloadViewerBtn')?.addEventListener('click', () => {
      this.downloadFile(fileData);
    });
  }

  /**
   * ファイルをダウンロード
   */
  downloadFile(fileData) {
    try {
      const fileName = fileData.name || 'file';
      
      if (fileData.data) {
        const link = document.createElement('a');
        link.href = `data:${fileData.type || 'application/octet-stream'};base64,${fileData.data}`;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log('✅ Download started:', fileName);
      } else {
        alert('File data not available');
      }
    } catch (error) {
      console.error('❌ Download failed:', error);
      alert('Download failed. Please try again.');
    }
  }

  /**
   * HTML エスケープ
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * ビューアーエラーを表示
   */
  showViewerError(message) {
    const viewerContainer = document.getElementById('viewerContainer');
    if (!viewerContainer) {
      const container = document.createElement('div');
      container.id = 'viewerContainer';
      document.body.appendChild(container);
    }

    document.getElementById('viewerContainer').innerHTML = `
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 2rem; border-radius: 8px; text-align: center; z-index: 1000;">
        <h2>Error</h2>
        <p>${this.escapeHtml(message)}</p>
        <a href="/" style="display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; text-decoration: none; border-radius: 4px;">Go Home</a>
      </div>
    `;
  }

  /**
   * ビューアーをクローズ
   */
  close() {
    const viewerContainer = document.getElementById('viewerContainer');
    if (viewerContainer) {
      viewerContainer.remove();
    }

    const mainContent = document.getElementById('mainContent');
    if (mainContent) mainContent.style.display = 'block';

    this.isViewing = false;
  }
}

// グローバルエクスポート
window.EmbeddedViewer = EmbeddedViewer;