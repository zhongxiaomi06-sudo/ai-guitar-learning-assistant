/**
 * core/video/fetcher.js
 * 视频抓取/导入：URL 解析、本地上传、下载
 */

/**
 * 视频抓取器
 * 负责把用户输入的视频 URL 或本地文件转换为可播放的 Blob URL。
 */
export class VideoFetcher {
  /**
   * 从本地文件创建视频 URL
   * @param {File} file
   * @returns {string}
   */
  static fromFile(file) {
    return URL.createObjectURL(file);
  }

  /**
   * 从 URL 抓取视频（需要后端支持）
   * @param {string} url
   * @returns {Promise<string>}
   */
  static async fromURL(url) {
    // TODO: 后端调用 yt-dlp / you-get 下载并返回视频地址
    console.log('[VideoFetcher] fetch video from', url);
    return url;
  }

  /**
   * 获取麦克风/音频输入
   * @returns {Promise<MediaStream>}
   */
  static async getAudioInput(deviceId = '') {
    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  /**
   * 枚举音频输入设备
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  static async enumerateAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    let permissionStream = null;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === 'audioinput');
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }
}

export default VideoFetcher;
