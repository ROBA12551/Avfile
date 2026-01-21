/**
 * js/video-compression.js
 * 
 * 動画圧縮エンジン（FFmpeg.wasm）
 * 720p 30fps で実際に圧縮
 */

class VideoCompressionEngine {
  constructor() {
    this.ffmpegReady = false;
    this.ffmpeg = null;
  }

  /**
   * FFmpeg を初期化
   */
  async initFFmpeg() {
    if (this.ffmpegReady) {
      return;
    }

    try {
      const { FFmpeg, fetchFile } = FFmpeg;
      this.ffmpeg = new FFmpeg.FFmpeg();
      
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
      this.ffmpeg.load({
        coreURL: await fetchFile(`${baseURL}/ffmpeg-core.js`),
      });

      await this.ffmpeg.isLoaded();
      this.ffmpegReady = true;
      console.log('✅ FFmpeg 初期化完了');
    } catch (error) {
      console.error('❌ FFmpeg 初期化失敗:', error);
      throw error;
    }
  }

  /**
   * 動画を圧縮
   */
  async compress(videoFile, onProgress = () => {}) {
    try {
      // FFmpeg を初期化
      await this.initFFmpeg();

      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      onProgress(10, '📥 ファイルを読み込み中...');

      // ファイルを FFmpeg に読み込む
      await this.ffmpeg.writeFile(inputFileName, await fetchFile(videoFile));

      onProgress(20, '🎬 動画情報を取得中...');

      // 動画情報を取得
      const metadata = await this.getVideoMetadata(inputFileName);
      console.log('📊 元の動画:', metadata);

      onProgress(30, '⚙️ 圧縮設定中...');

      // 圧縮コマンド（720p 30fps）
      const command = [
        '-i', inputFileName,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '28',
        '-b:v', '1500k',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputFileName,
      ];

      onProgress(35, '🔄 圧縮処理中...');

      // 圧縮実行
      await this.ffmpeg.run(...command);

      onProgress(80, '💾 ファイルを出力中...');

      // 圧縮済みファイルを取得
      const compressedData = await this.ffmpeg.readFile(outputFileName);
      const compressedBlob = new Blob([compressedData.buffer], { type: 'video/mp4' });

      onProgress(90, '🧹 クリーンアップ中...');

      // ファイルをクリア
      await this.ffmpeg.deleteFile(inputFileName);
      await this.ffmpeg.deleteFile(outputFileName);

      onProgress(100, '✅ 圧縮完了');

      const originalMB = (videoFile.size / 1024 / 1024).toFixed(1);
      const compressedMB = (compressedBlob.size / 1024 / 1024).toFixed(1);
      const ratio = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0);
      
      console.log(`📊 圧縮結果: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);

      return compressedBlob;
    } catch (error) {
      console.error('❌ 圧縮エラー:', error);
      throw new Error(`動画圧縮失敗: ${error.message}`);
    }
  }

  /**
   * 動画のメタデータを取得
   */
  async getVideoMetadata(fileName) {
    try {
      // ffprobe コマンドで動画情報を取得
      // 簡易版では、リサイズ前の情報を推定する
      return {
        format: 'unknown',
        duration: 'unknown',
        bitrate: 'unknown',
      };
    } catch (error) {
      return {};
    }
  }
}

// グローバルエクスポート
window.VideoCompressionEngine = VideoCompressionEngine;

// FFmpeg.wasm を動的にロード
const script = document.createElement('script');
script.async = true;
script.src = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js';
document.head.appendChild(script);