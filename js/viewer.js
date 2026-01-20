/**
 * js/viewer.js
 * 
 * ビデオプレビュー・ビューアページのロジック
 * - Release ID からファイル情報を取得
 * - 動画をストリーミング再生
 * - ダウンロード・共有機能
 * - 通報機能
 */

// グローバル状態
const viewerState = {
  storage: null,
  releaseId: null,
  fileData: null,
  isLoaded: false,
};

/**
 * 初期化
 */
document.addEventListener('DOMContentLoaded', async () => {
  viewerState.storage = new StorageManager();

  // URL から Release ID を取得
  const urlParams = new URLSearchParams(window.location.search);
  viewerState.releaseId = urlParams.get('id') || getReleaseIdFromPath();

  if (!viewerState.releaseId) {
    showError('No file specified');
    return;
  }

  // ファイル情報を取得
  await loadFileInfo();

  // イベントリスナー登録
  setupEventListeners();

  console.log('✅ Viewer initialized');
});

/**
 * パスから Release ID を抽出
 * 例: /v/123456 → 123456
 */
function getReleaseIdFromPath() {
  const pathMatch = window.location.pathname.match(/\/v\/(\d+)/);
  return pathMatch ? pathMatch[1] : null;
}

/**
 * ファイル情報を取得（GitHub から）
 */
async function loadFileInfo() {
  try {
    console.log('📥 Loading file info...');
    showPreparing();

    // モック実装: 実際は Netlify Function で取得
    // const response = await fetch(`/.netlify/functions/file-info?releaseId=${viewerState.releaseId}`);
    // const data = await response.json();

    // テスト用のサンプルデータ
    viewerState.fileData = {
      file_id: 'test-' + viewerState.releaseId,
      release_id: viewerState.releaseId,
      title: 'Sample Video',
      original_filename: 'sample-video.mp4',
      compressed_size: 95000000,
      created_at: new Date().toISOString(),
      download_url: `https://github.com/releases/download/video_${viewerState.releaseId}/video_${viewerState.releaseId}.mp4`,
      view_count: Math.floor(Math.random() * 100),
    };

    // 再生回数を増加
    viewerState.storage.incrementViewCount(viewerState.fileData.file_id);

    // UI を更新
    showContent(viewerState.fileData);
    viewerState.isLoaded = true;

    console.log('✅ File loaded');
  } catch (error) {
    console.error('❌ Error loading file:', error);
    showError('Failed to load file. ' + error.message);
  }
}

/**
 * 準備中画面を表示
 */
function showPreparing() {
  document.getElementById('preparingArea').style.display = 'block';
  document.getElementById('contentArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'none';

  // プログレスアニメーション
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 30;
    if (progress > 90) progress = 90;

    const progressFill = document.getElementById('preparingProgress');
    progressFill.style.width = progress + '%';

    if (viewerState.isLoaded) {
      clearInterval(interval);
    }
  }, 300);
}

/**
 * コンテンツを表示
 * @param {Object} fileData - ファイル情報
 */
function showContent(fileData) {
  document.getElementById('preparingArea').style.display = 'none';
  document.getElementById('contentArea').style.display = 'block';
  document.getElementById('errorArea').style.display = 'none';

  // ファイル情報を表示
  document.getElementById('fileName').textContent = fileData.title || fileData.original_filename;

  // ファイルサイズをフォーマット
  const sizeInMB = (fileData.compressed_size / 1024 / 1024).toFixed(1);
  document.getElementById('fileSize').innerHTML =
    `<strong>Size:</strong> ${sizeInMB} MB`;

  // アップロード日時
  const uploadDate = new Date(fileData.created_at).toLocaleString();
  document.getElementById('uploadTime').innerHTML =
    `<strong>Uploaded:</strong> ${uploadDate}`;

  // 動画ソースを設定
  const videoSource = document.getElementById('videoSource');
  videoSource.src = fileData.download_url;
  videoSource.type = 'video/mp4';

  // ビデオプレイヤーを再読み込み
  const videoPlayer = document.getElementById('videoPlayer');
  videoPlayer.load();

  // 共有 URL を設定
  const shareUrl = window.location.href;
  document.getElementById('shareUrl').value = shareUrl;
}

/**
 * エラー画面を表示
 * @param {string} message - エラーメッセージ
 */
function showError(message) {
  document.getElementById('preparingArea').style.display = 'none';
  document.getElementById('contentArea').style.display = 'none';
  document.getElementById('errorArea').style.display = 'block';

  document.getElementById('errorMessage').textContent = message;
}

/**
 * イベントリスナー登録
 */
function setupEventListeners() {
  // コピーボタン
  document.getElementById('copyBtn')?.addEventListener('click', () => {
    const shareUrl = document.getElementById('shareUrl');
    shareUrl.select();

    navigator.clipboard.writeText(shareUrl.value).then(() => {
      const btn = document.getElementById('copyBtn');
      const originalText = btn.textContent;

      btn.textContent = '✓ Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    });
  });

  // ダウンロードボタン
  document.getElementById('downloadBtn')?.addEventListener('click', () => {
    if (viewerState.fileData) {
      const link = document.createElement('a');
      link.href = viewerState.fileData.download_url;
      link.download = viewerState.fileData.original_filename || 'download';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });

  // 再生ボタン
  document.getElementById('playBtn')?.addEventListener('click', () => {
    const videoPlayer = document.getElementById('videoPlayer');
    if (videoPlayer.paused) {
      videoPlayer.play();
    } else {
      videoPlayer.pause();
    }
  });

  // 通報ボタン
  document.getElementById('reportBtn')?.addEventListener('click', () => {
    document.getElementById('reportModal').style.display = 'flex';
  });

  // モーダル閉じるボタン
  document.getElementById('closeReport')?.addEventListener('click', () => {
    document.getElementById('reportModal').style.display = 'none';
  });

  document.getElementById('cancelReport')?.addEventListener('click', () => {
    document.getElementById('reportModal').style.display = 'none';
  });

  // 通報フォーム送信
  document.getElementById('reportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const reason = document.getElementById('reportReason').value;
    const details = document.getElementById('reportDetails').value;

    if (!reason) {
      alert('Please select a reason');
      return;
    }

    try {
      // 通報を送信（本実装では Netlify Function へ）
      console.log('📤 Submitting report:', { reason, details });

      // モック実装
      alert('Report submitted. Thank you for helping us keep the platform safe.');
      document.getElementById('reportModal').style.display = 'none';
      document.getElementById('reportForm').reset();
    } catch (error) {
      alert('Failed to submit report: ' + error.message);
    }
  });

  // テキストエリアの文字数カウント
  document.getElementById('reportDetails')?.addEventListener('input', (e) => {
    const count = e.target.value.length;
    document.getElementById('charCount').textContent = `${count}/500`;
  });

  // ソーシャルシェア
  setupSocialShare();

  // モーダル外側をクリックで閉じる
  document.getElementById('reportModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reportModal') {
      document.getElementById('reportModal').style.display = 'none';
    }
  });
}

/**
 * ソーシャルシェア機能
 */
function setupSocialShare() {
  const shareUrl = window.location.href;

  document.getElementById('shareTwitter')?.addEventListener('click', () => {
    const text = encodeURIComponent(`Check out this video: "${viewerState.fileData?.title || 'Video'}"`);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`,
      '_blank',
      'width=500,height=400'
    );
  });

  document.getElementById('shareLINE')?.addEventListener('click', () => {
    window.open(
      `https://line.me/R/msg/text/${encodeURIComponent(shareUrl)}`,
      '_blank'
    );
  });

  document.getElementById('shareEmail')?.addEventListener('click', () => {
    const subject = encodeURIComponent(`Video: ${viewerState.fileData?.title || 'Shared Video'}`);
    const body = encodeURIComponent(`Check out this video:\n\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  });
}