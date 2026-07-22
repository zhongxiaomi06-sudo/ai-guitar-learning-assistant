/**
 * core/voice/controller.js
 * High-level voice controller: hold/release to record, send to backend,
 * and dispatch the returned command.
 */

import { VoiceRecorder } from './recorder.js';
import { sendVoiceCommand } from './client.js';

export class VoiceController {
  constructor(options = {}) {
    this.dispatcher = options.dispatcher || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.maxDurationMs = options.maxDurationMs || 6000;
    this.cooldownMs = options.cooldownMs || 1200;

    this.recorder = new VoiceRecorder();
    this.recording = false;
    this.processing = false;
    this.timer = null;
    this.cooldown = false;
  }

  static isSupported() {
    return Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.MediaRecorder);
  }

  async toggle() {
    if (this.recording) return this.stop();
    if (this.cooldown) return;
    return this.start();
  }

  async start() {
    if (this.recording || this.cooldown) return;
    try {
      await this.recorder.start();
      this.recording = true;
      this.onStateChange('recording');
      this.timer = window.setTimeout(() => this.stop(), this.maxDurationMs);
    } catch (error) {
      this.recording = false;
      this.onStateChange('error', error.message);
    }
  }

  async stop() {
    if (!this.recording) return;
    window.clearTimeout(this.timer);
    this.timer = null;
    this.recording = false;
    this.processing = true;
    this.onStateChange('processing');

    const blob = await this.recorder.stop();
    if (!blob) {
      this.processing = false;
      this.onStateChange('idle');
      return;
    }

    try {
      const result = await sendVoiceCommand(blob);
      this.processing = false;
      this.onStateChange('idle');
      this._execute(result);
    } catch (error) {
      this.processing = false;
      this.onStateChange('error', error.message);
    } finally {
      this._setCooldown();
    }
  }

  _execute(result) {
    if (!result || result.action === 'unrecognized') {
      this.onStateChange('unrecognized', result?.raw_text || '');
      return;
    }
    this.dispatcher(result.action, result.payload || {});
    this.onStateChange('executed', result);
  }

  _setCooldown() {
    this.cooldown = true;
    window.setTimeout(() => {
      this.cooldown = false;
    }, this.cooldownMs);
  }
}

export default VoiceController;
