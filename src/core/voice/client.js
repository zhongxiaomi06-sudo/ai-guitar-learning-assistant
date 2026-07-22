/**
 * core/voice/client.js
 * Sends recorded audio to the backend voice-control proxy and returns the
 * parsed command.
 */

import { postForm } from '../../shared/utils/api.js';

/**
 * @param {Blob} audioBlob
 * @returns {Promise<{action: string, payload: object, confidence: number, raw_text: string, reply?: string}>}
 */
export async function sendVoiceCommand(audioBlob) {
  const form = new FormData();
  const extension = audioBlob.type?.includes('webm') ? 'webm' : 'ogg';
  form.append('audio', audioBlob, `voice.${extension}`);
  return postForm('/api/v1/voice/recognize', form, { timeoutMs: 30_000 });
}

export default sendVoiceCommand;
