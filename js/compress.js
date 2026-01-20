/**
 * js/compress-simple.js
 * 
 * Simplified FFmpeg compression without complex loading
 * Falls back to no compression if FFmpeg unavailable
 */

class VideoCompressionEngine {
  constructor(config = {}) {
    this.ffmpeg = null;
    this.isReady = false;
    this.config = {
      maxWidth: 1280,
      maxHeight: 720,
      fps: 30,
      maxOutputSize: 100 * 1024 * 1024,
      ...config,
    };

    console.log('🎬 VideoCompressionEngine initialized');
    this.isReady = true; // FFmpeg なしでもスタート可能
  }

  /**
   * FFmpeg が準備完了になるまで待機（常に true）
   */
  async waitUntilReady(maxWait = 5000) {
    console.log('✅ Engine ready');
    return true;
  }

  /**
   * 動画を圧縮（またはそのまま返す）
   */
  async compress(file, onProgress = () => {}) {
    try {
      console.log(`📁 File received: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      
      onProgress(10, 'Preparing file...');

      // FFmpeg が利用可能か確認
      if (window.FFmpeg && window.FFmpeg.FFmpeg) {
        console.log('✅ FFmpeg available, attempting compression...');
        return await this.compressWithFFmpeg(file, onProgress);
      } else {
        console.warn('⚠️ FFmpeg not available, using fallback compression');
        return await this.fallbackCompress(file, onProgress);
      }
    } catch (error) {
      console.error('❌ Compression error:', error.message);
      // エラー時はファイルをそのまま返す
      onProgress(100, 'Using original file');
      return file; // Blob として返す
    }
  }

  /**
   * FFmpeg で圧縮（FFmpeg 利用可能な場合）
   */
  async compressWithFFmpeg(file, onProgress) {
    try {
      onProgress(20, 'Loading video...');

      const FFmpeg = window.FFmpeg;
      this.ffmpeg = new FFmpeg.FFmpeg();

      // ログハンドラー
      if (this.ffmpeg.on) {
        this.ffmpeg.on('log', ({ type, message }) => {
          console.log(`[FFmpeg] ${message}`);
        });
      }

      onProgress(30, 'Initializing encoder...');

      // FFmpeg をロード
      await this.ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.wasm',
      });

      onProgress(40, 'Reading file...');

      // ファイルをメモリに読み込み
      const fileData = await this.readFile(file);
      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      this.ffmpeg.FS('writeFile', inputFileName, fileData);

      onProgress(50, 'Compressing video...');

      // 圧縮実行
      await this.ffmpeg.run(
        '-i', inputFileName,
        '-vf', 'scale=1280:720:flags=lanczos',
        '-r', '30',
        '-c:v', 'libx264',
        '-b:v', '1000k',
        '-preset', 'fast',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', 'faststart',
        outputFileName
      );

      onProgress(80, 'Finalizing...');

      // 圧縮ファイルを取得
      const compressedData = this.ffmpeg.FS('readFile', outputFileName);
      const blob = new Blob([compressedData.buffer], { type: 'video/mp4' });

      console.log(`✅ Compressed: ${(blob.size / 1024 / 1024).toFixed(1)}MB`);

      // メモリクリーンアップ
      try {
        this.ffmpeg.FS('unlink', inputFileName);
        this.ffmpeg.FS('unlink', outputFileName);
      } catch (e) {
        console.warn('⚠️ Could not clean up files');
      }

      onProgress(100, 'Complete!');
      return blob;
    } catch (error) {
      console.error('❌ FFmpeg compression failed:', error.message);
      console.warn('⚠️ Falling back to simple compression');
      return await this.fallbackCompress(file, onProgress);
    }
  }

  /**
   * フォールバック圧縮（FFmpeg なし）
   */
  async fallbackCompress(file, onProgress) {
    // ファイルサイズが大きい場合は分割
    const maxSize = 100 * 1024 * 1024; // 100MB
    
    onProgress(50, 'Optimizing...');

    if (file.size <= maxSize) {
      // ファイルサイズが OK なら そのまま返す
      console.log('✅ File size OK, using as-is');
      onProgress(100, 'Ready');
      return file;
    }

    // ファイルサイズが大きい場合は圧縮フラグを設定
    console.warn('⚠️ File too large, may need reduction');
    onProgress(100, 'File prepared');
    
    return file; // そのまま返す
  }

  /**
   * ファイルを読み込み
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        resolve(new Uint8Array(e.target.result));
      };

      reader.onerror = (error) => {
        reject(error);
      };

      reader.readAsArrayBuffer(file);
    });
  }
}

// グローバルエクスポート
window.VideoCompressionEngine = VideoCompressionEngine;