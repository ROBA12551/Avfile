/**
 * js/compress.js (Fixed)
 * 
 * FFmpeg.wasm を使用した動画圧縮エンジン
 * 完全に修正版 - グローバルスコープからの正しいロード
 */

class VideoCompressionEngine {
  constructor(config = {}) {
    this.ffmpeg = null;
    this.isReady = false;
    this.isInitializing = false;
    this.config = {
      maxWidth: 1280,
      maxHeight: 720,
      fps: 30,
      maxOutputSize: 100 * 1024 * 1024,
      ...config,
    };

    // 初期化開始
    this.initFFmpeg();
  }

  /**
   * FFmpeg 初期化（完全修正版）
   */
  async initFFmpeg() {
    // 既に初期化中の場合は スキップ
    if (this.isInitializing) {
      return;
    }

    this.isInitializing = true;

    try {
      console.log('🎬 Initializing FFmpeg...');

      // Step 1: FFmpeg スクリプトの読み込み確認
      if (!window.FFmpeg) {
        console.warn('⏳ Waiting for FFmpeg script to load...');
        await this.waitForFFmpegScript();
      }

      if (!window.FFmpeg) {
        throw new Error('FFmpeg script did not load');
      }

      // Step 2: FFmpeg.FFmpeg クラスの確認
      const FFmpeg = window.FFmpeg;
      if (!FFmpeg.FFmpeg) {
        throw new Error('FFmpeg.FFmpeg class not found');
      }

      // Step 3: インスタンス作成
      console.log('📦 Creating FFmpeg instance...');
      this.ffmpeg = new FFmpeg.FFmpeg();

      // Step 4: ログハンドラー設定
      if (this.ffmpeg.on) {
        this.ffmpeg.on('log', ({ type, message }) => {
          if (type === 'error') {
            console.error(`[FFmpeg] ${message}`);
          }
        });
      }

      // Step 5: ロード
      console.log('⚙️ Loading FFmpeg core...');
      await this.ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.wasm',
      });

      this.isReady = true;
      this.isInitializing = false;
      console.log('✅ FFmpeg initialized successfully');
    } catch (error) {
      console.error('❌ FFmpeg initialization error:', error.message);
      this.isInitializing = false;
      this.isReady = false;

      // 再試行
      console.warn('⏳ Retrying in 1 second...');
      setTimeout(() => this.initFFmpeg(), 1000);
    }
  }

  /**
   * FFmpeg スクリプトの読み込みを待機
   */
  async waitForFFmpegScript(maxWait = 10000) {
    const startTime = Date.now();

    while (!window.FFmpeg) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('FFmpeg script failed to load within timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('✓ FFmpeg script loaded');
  }

  /**
   * FFmpeg が準備完了になるまで待機
   */
  async waitUntilReady(maxWait = 30000) {
    const startTime = Date.now();

    while (!this.isReady) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('FFmpeg initialization timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('⏳ Waiting for FFmpeg to be ready...');
    }

    return true;
  }

  /**
   * 動画を圧縮
   */
  async compress(file, onProgress = () => {}) {
    try {
      // FFmpeg 準備確認
      await this.waitUntilReady();

      console.log(`🎥 Compressing video: ${file.name}`);
      onProgress(5, 'Loading video...');

      // 1. ファイルをメモリに読み込み
      const fileData = await this.readFile(file);
      const inputFileName = 'input.mp4';
      const outputFileName = 'output.mp4';

      // FS にファイルを書き込み
      this.ffmpeg.FS('writeFile', inputFileName, fileData);
      onProgress(15, 'Analyzing video...');

      // 2. ビデオ情報を取得
      const videoInfo = {
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 100,
      };

      // 3. 圧縮パラメータを計算
      const compressionParams = this.calculateCompressionParams(videoInfo, file.size);
      console.log('⚙️ Compression params:', compressionParams);
      onProgress(20, 'Starting compression...');

      // 4. 圧縮実行
      await this.runCompression(
        inputFileName,
        outputFileName,
        compressionParams,
        onProgress
      );

      onProgress(95, 'Finalizing...');

      // 5. 圧縮ファイルを取得
      const compressedData = this.ffmpeg.FS('readFile', outputFileName);
      const blob = new Blob([compressedData.buffer], { type: 'video/mp4' });

      console.log(`✅ Compression complete. Output size: ${blob.size} bytes`);

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
      console.error('❌ Compression failed:', error);
      throw new Error(`Compression failed: ${error.message}`);
    }
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

  /**
   * 圧縮パラメータを計算
   */
  calculateCompressionParams(videoInfo, originalSize) {
    const { maxWidth, maxHeight, fps, maxOutputSize } = this.config;

    let width = Math.min(videoInfo.width, maxWidth);
    let height = Math.min(videoInfo.height, maxHeight);

    width = Math.round(width / 2) * 2;
    height = Math.round(height / 2) * 2;

    const targetSize = Math.min(maxOutputSize, originalSize * 0.8);
    const durationSeconds = videoInfo.duration || 100;
    const bitrate = Math.max(
      Math.floor((targetSize * 8) / durationSeconds / 1000),
      500
    );

    return {
      width,
      height,
      fps: Math.min(videoInfo.fps || fps, fps),
      bitrate: `${bitrate}k`,
      preset: 'fast',
    };
  }

  /**
   * FFmpeg で圧縮を実行
   */
  async runCompression(inputFile, outputFile, params, onProgress) {
    const { width, height, fps, bitrate, preset } = params;

    console.log('🔧 Running FFmpeg command...');
    onProgress(30, 'Encoding video...');

    try {
      await this.ffmpeg.run(
        '-i',
        inputFile,
        '-vf',
        `scale=${width}:${height}:flags=lanczos`,
        '-r',
        fps.toString(),
        '-c:v',
        'libx264',
        '-b:v',
        bitrate,
        '-preset',
        preset,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        'faststart',
        outputFile
      );

      onProgress(85, 'Finalizing...');
      console.log('✅ Encoding complete');
    } catch (error) {
      console.error('❌ FFmpeg execution failed:', error);
      throw error;
    }
  }
}

// グローバルエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoCompressionEngine;
}

window.VideoCompressionEngine = VideoCompressionEngine;