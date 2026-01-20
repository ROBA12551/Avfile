

// グローバル状態
const appState = {
  storage: null,
  compression: null,
  github: null,  // GitHubUploadManagerNetlify
  currentFile: null,
  isProcessing: false,
};

/**
 * 初期化
 */
document.addEventListener('DOMContentLoaded', () => {
  // 各モジュールを初期化
  appState.storage = new StorageManager();
  appState.compression = new VideoCompressionEngine();

  // Netlify Functions 経由の GitHub API クライアント
  appState.github = new GitHubUploadManagerNetlify({
    apiBaseUrl: '/.netlify/functions',
    requestTimeout: 30000,
  });

  // イベントリスナー登録
  setupEventListeners();

  // マイファイル一覧を表示
  displayMyFiles();

  console.log('✅ App initialized with Netlify Functions');
});

/**
 * イベントリスナー登録
 */
function setupEventListeners() {
  const fileInput = document.getElementById('fileInput');
  const selectFileBtn = document.getElementById('selectFileBtn');
  const uploadArea = document.getElementById('uploadArea');

  // ファイル選択ボタン
  selectFileBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // ファイル入力
  fileInput.addEventListener('change', (e) => {
    handleFileSelect(e.target.files[0]);
  });

  // ドラッグ&ドロップ
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    handleFileSelect(e.dataTransfer.files[0]);
  });

  // 完了後のボタン
  document.getElementById('copyUrlBtn')?.addEventListener('click', copyShareUrl);
  document.getElementById('uploadMoreBtn')?.addEventListener('click', resetForm);
  document.getElementById('viewMyFilesBtn')?.addEventListener('click', () => {
    document.getElementById('myFilesSection').scrollIntoView({ behavior: 'smooth' });
  });

  // リトライボタン
  document.getElementById('retryBtn')?.addEventListener('click', resetForm);

  // マイファイル削除
  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
    if (confirm('⚠️ すべてのアップロード履歴を削除します。\nこの操作は取り消せません。')) {
      appState.storage.clearAll();
      displayMyFiles();
    }
  });

  // ソーシャルシェア
  setupSocialShare();
}

/**
 * ファイル選択処理
 * @param {File} file
 */
async function handleFileSelect(file) {
  if (!file) return;

  // ファイルバリデーション
  if (!file.type.startsWith('video/')) {
    showError('動画ファイル（MP4, WebM など）を選択してください。');
    return;
  }

  appState.currentFile = file;

  // UI を処理中に変更
  showProcessing();

  try {
    // 1. 圧縮処理（クライアント側）
    console.log('📥 ファイルを圧縮中...', file.name);
    const compressedBlob = await appState.compression.compress(
      file,
      (percent, message) => {
        updateProgress(percent * 0.5, message); // 圧縮は全体の 50%
      }
    );

    console.log('✅ 圧縮完了');

    // 2. Netlify Functions 経由で GitHub へアップロード
    console.log('📤 Netlify Functions にアップロード中...');
    updateProgress(50, 'アップロード中...');

    const fileId = generateUUID();
    const metadata = {
      file_id: fileId,
      original_filename: file.name,
      original_size: file.size,
      compressed_size: compressedBlob.size,
      compression_ratio: (compressedBlob.size / file.size).toFixed(4),
      resolution: '720p',
      fps: 30,
      upload_time: new Date().toISOString(),
      uploader_id: appState.storage.getUserId(),
      title: file.name.replace(/\.[^/.]+$/, ''), // 拡張子を除去
    };

    const uploadResult = await appState.github.uploadWithMetadata(
      compressedBlob,
      metadata,
      (percent, message) => {
        updateProgress(50 + percent * 0.5, message); // アップロードは 50-100%
      }
    );

    // 3. localStorage に記録
    appState.storage.addUpload({
      file_id: fileId,
      release_id: uploadResult.release_id,
      title: metadata.title,
      original_filename: file.name,
      original_size: file.size,
      compressed_size: compressedBlob.size,
      asset_url: uploadResult.asset_url,
      download_url: uploadResult.asset_url,
    });

    // 4. 成功画面を表示
    updateProgress(100, 'アップロード完了！');
    showSuccess(uploadResult);

    // マイファイル一覧を更新
    displayMyFiles();

    console.log('✅ ファイルアップロード成功');
  } catch (error) {
    console.error('❌ エラー:', error);
    const userMessage = GitHubUploadManagerNetlify.getErrorMessage(error);
    showError(userMessage);
  }
}

/**
 * 処理中画面を表示
 */
function showProcessing() {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'block';
  document.getElementById('successArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'none';
  appState.isProcessing = true;
}

/**
 * プログレス更新
 * @param {number} percent - 進捗率 (0-100)
 * @param {string} message - メッセージ
 */
function updateProgress(percent, message) {
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');

  progressFill.style.width = Math.min(percent, 100) + '%';
  progressText.textContent = Math.round(percent) + '%';

  document.getElementById('processingMessage').textContent = message;
  document.getElementById('processingTitle').textContent = message;

  console.log(`📊 ${percent.toFixed(0)}% - ${message}`);
}

/**
 * 成功画面を表示
 * @param {Object} uploadResult - アップロード結果
 */
function showSuccess(uploadResult) {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'block';
  document.getElementById('errorArea').style.display = 'none';

  // 共有 URL を生成
  const shareUrl = `${window.location.origin}/v/${uploadResult.release_id}`;

  document.getElementById('shareUrl').value = shareUrl;

  // 統計情報を更新
  const stats = appState.storage.getStatistics();
  document.getElementById('totalUploads').textContent = stats.active_uploads;
  document.getElementById('totalStorage').textContent =
    (stats.total_storage_used / 1024 / 1024).toFixed(1) + ' MB';

  // ページの上部にスクロール
  document.querySelector('.upload-section').scrollIntoView({ behavior: 'smooth' });
}

/**
 * エラー画面を表示
 * @param {string} message - エラーメッセージ
 */
function showError(message) {
  document.getElementById('uploadArea').style.display = 'none';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'block';

  document.getElementById('errorMessage').textContent = message;
  appState.isProcessing = false;
}

/**
 * フォームをリセット
 */
function resetForm() {
  document.getElementById('uploadArea').style.display = 'block';
  document.getElementById('processingArea').style.display = 'none';
  document.getElementById('successArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'none';

  document.getElementById('fileInput').value = '';
  document.getElementById('progressFill').style.width = '0%';

  appState.currentFile = null;
  appState.isProcessing = false;
}

/**
 * 共有 URL をコピー
 */
function copyShareUrl() {
  const shareUrl = document.getElementById('shareUrl');
  shareUrl.select();

  navigator.clipboard.writeText(shareUrl.value).then(() => {
    const btn = document.getElementById('copyUrlBtn');
    const originalText = btn.textContent;

    btn.textContent = '✅ コピーしました';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
}

/**
 * ソーシャルシェア機能
 */
function setupSocialShare() {
  document.getElementById('shareTwitter')?.addEventListener('click', () => {
    const url = document.getElementById('shareUrl').value;
    const text = encodeURIComponent('この動画をチェック: ' + url);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}`,
      '_blank',
      'width=500,height=400'
    );
  });

  document.getElementById('shareLINE')?.addEventListener('click', () => {
    const url = document.getElementById('shareUrl').value;
    window.open(
      `https://line.me/R/msg/text/${encodeURIComponent(url)}`,
      '_blank'
    );
  });

  document.getElementById('shareEmail')?.addEventListener('click', () => {
    const url = document.getElementById('shareUrl').value;
    const subject = encodeURIComponent('動画を共有します');
    const body = encodeURIComponent(`この動画をご覧ください:\n${url}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  });
}

/**
 * マイファイル一覧を表示
 */
function displayMyFiles() {
  const uploads = appState.storage.getActiveUploads();
  const filesList = document.getElementById('myFilesList');
  const myFilesSection = document.getElementById('myFilesSection');

  if (uploads.length === 0) {
    myFilesSection.style.display = 'none';
    return;
  }

  myFilesSection.style.display = 'block';
  filesList.innerHTML = '';

  uploads.forEach((upload) => {
    const fileCard = document.createElement('div');
    fileCard.className = 'file-card';

    const fileUrl = `${window.location.origin}/v/${upload.release_id}`;
    const uploadDate = new Date(upload.uploaded_at).toLocaleString('ja-JP');
    const sizeStr = (upload.compressed_size / 1024 / 1024).toFixed(1);

    fileCard.innerHTML = `
      <div class="file-card-title" title="${upload.title}">
        ${escapeHtml(upload.title)}
      </div>
      <div class="file-card-info">
        <span> ${uploadDate}</span>
        <span> ${sizeStr} MB</span>
        <span> ${upload.view_count || 0} 回再生</span>
      </div>
      <div class="file-card-actions">
        <button class="btn btn-primary btn-small" onclick="copyToClipboard('${fileUrl}')">
          リンクコピー
        </button>
        <button class="btn btn-secondary btn-small" onclick="openFile('${fileUrl}')">
          表示
        </button>
      </div>
    `;

    filesList.appendChild(fileCard);
  });
}

/**
 * グローバル関数
 */
window.copyToClipboard = function (url) {
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ リンクをコピーしました');
  });
};

window.openFile = function (url) {
  window.open(url, '_blank');
};

/**
 * HTML エスケープ（XSS 対策）
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * UUID を生成
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 離脱時の警告（処理中の場合）
 */
window.addEventListener('beforeunload', (e) => {
  if (appState.isProcessing) {
    e.preventDefault();
    e.returnValue = '処理中です。ページを離れると中断されます。';
    return '処理中です。ページを離れると中断されます。';
  }
});