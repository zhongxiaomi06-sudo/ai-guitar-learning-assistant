/**
 * core/voice/recorder.js
 * Browser-side audio capture using MediaRecorder. Produces a WebM/Opus blob
 * that the backend can transcode and send to Baidu Speech Recognition.
 */

export class VoiceRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioStream = null;
    this.recordedChunks = [];
    this.mimeType = this._chooseMimeType();
  }

  _chooseMimeType() {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (const type of preferred) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风录制');
    }
    this.recordedChunks = [];
    this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = this.mimeType ? { mimeType: this.mimeType } : {};
    this.mediaRecorder = new MediaRecorder(this.audioStream, options);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.recordedChunks.push(event.data);
    };
    this.mediaRecorder.start(100);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        this._release();
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        const type = this.mimeType || 'audio/webm';
        const blob = this.recordedChunks.length > 0
          ? new Blob(this.recordedChunks, { type })
          : null;
        this._release();
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  _release() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
    this.mediaRecorder = null;
    this.recordedChunks = [];
  }
}

export default VoiceRecorder;
