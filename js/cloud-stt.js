/**
 * Cloud STT (Speech-to-Text) — Baidu / iFlytek backends.
 * Used for Chinese dialects not supported by browser Web Speech API.
 *
 * Baidu: free 50,000 calls/day. Needs API Key + Secret Key.
 * Register: https://console.bce.baidu.com/ai/#/ai/speech/overview/index
 *
 * Audio pipeline: MediaRecorder (webm/opus) → decode → resample 16kHz mono → WAV → Baidu API
 */

const CloudSTT = (() => {

  // ── Dialect definitions ──────────────────────
  const DIALECTS = {
    'sichuan': { name: '四川话', baiduPid: 1637, iflytekAccent: 'sichuanhua' },
    'cantonese': { name: '粤语', baiduPid: 1536, iflytekAccent: 'cantonese' },
    'shanghai': { name: '上海话', baiduPid: null, iflytekAccent: 'shanghainese',
                   note: '仅支持讯飞API' },
    'henan': { name: '河南话', baiduPid: null, iflytekAccent: 'henanhua',
               note: '仅支持讯飞API' },
  };

  // ── Config storage ───────────────────────────
  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem('cloud-stt-config') || '{}');
    } catch (_) { return {}; }
  }

  function saveConfig(cfg) {
    localStorage.setItem('cloud-stt-config', JSON.stringify(cfg));
  }

  function isConfigured(provider) {
    const cfg = getConfig();
    if (provider === 'baidu') {
      return !!(cfg.baiduApiKey && cfg.baiduSecretKey);
    }
    if (provider === 'iflytek') {
      return !!(cfg.iflytekAppId && cfg.iflytekApiKey && cfg.iflytekApiSecret);
    }
    return false;
  }

  // ── WebM → PCM WAV conversion ────────────────
  /**
   * Convert a webm/opus audio blob to 16kHz 16-bit mono PCM WAV.
   * Uses Web Audio API to decode + OfflineAudioContext to resample.
   */
  async function webmToWav(webmBlob) {
    // Decode the webm audio
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // Resample to 16kHz mono using OfflineAudioContext
    const targetRate = 16000;
    const duration = audioBuffer.duration;
    const offlineCtx = new OfflineAudioContext(1, targetRate * duration, targetRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();
    audioCtx.close();

    // Encode as 16-bit PCM WAV
    return encodeWav(rendered, targetRate);
  }

  /**
   * Encode an AudioBuffer as a WAV blob (16-bit PCM, mono).
   */
  function encodeWav(audioBuffer, sampleRate) {
    const numChannels = audioBuffer.numberOfChannels;
    const channelData = audioBuffer.getChannelData(0);
    const numSamples = channelData.length;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = numSamples * (bitsPerSample / 8);
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);           // PCM
    view.setUint16(20, 1, true);            // format = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // PCM samples (float32 → int16)
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // ── Baidu STT ────────────────────────────────
  async function baiduAccessToken(apiKey, secretKey) {
    const url = 'https://aip.baidubce.com/oauth/2.0/token' +
      '?grant_type=client_credentials' +
      '&client_id=' + encodeURIComponent(apiKey) +
      '&client_secret=' + encodeURIComponent(secretKey);
    const r = await fetch(url, { method: 'POST' });
    const d = await r.json();
    if (d.access_token) return d.access_token;
    throw new Error(d.error_description || 'Baidu auth failed');
  }

  async function baiduRecognize(audioBlob, devPid) {
    const cfg = getConfig();
    if (!cfg.baiduApiKey || !cfg.baiduSecretKey) {
      throw new Error('baidu_not_configured');
    }

    // Get access token (cached in memory for the session)
    let token = baiduRecognize._cachedToken;
    if (!token) {
      token = await baiduAccessToken(cfg.baiduApiKey, cfg.baiduSecretKey);
      baiduRecognize._cachedToken = token;
    }

    // Convert webm → WAV if needed (MediaRecorder outputs webm)
    let wavBlob = audioBlob;
    if (audioBlob.type.startsWith('audio/webm') || audioBlob.type.startsWith('audio/ogg')) {
      try {
        wavBlob = await webmToWav(audioBlob);
      } catch (e) {
        console.warn('[CloudSTT] Audio conversion failed, trying raw blob:', e.message);
        // Fall through — Baidu may reject it, but we try anyway
      }
    }

    // Convert blob to base64
    const base64 = await blobToBase64(wavBlob);

    const body = new URLSearchParams();
    body.append('format', 'wav');
    body.append('rate', '16000');
    body.append('channel', '1');
    body.append('cuid', 'voice-translator-app');
    body.append('token', token);
    body.append('dev_pid', String(devPid));
    body.append('speech', base64);
    body.append('len', String(wavBlob.size));

    const doRequest = async (bodyParams) => {
      const r = await fetch('https://vop.baidu.com/server_api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams.toString(),
      });
      return r.json();
    };

    const d = await doRequest(body);

    if (d.err_no === 0 && d.result && d.result.length > 0) {
      return d.result.join('');
    }

    // Token expired — clear cache and retry once
    if (d.err_no === 3302) {
      baiduRecognize._cachedToken = null;
      token = await baiduAccessToken(cfg.baiduApiKey, cfg.baiduSecretKey);
      baiduRecognize._cachedToken = token;
      body.set('token', token);
      const d2 = await doRequest(body);
      if (d2.err_no === 0 && d2.result) {
        return d2.result.join('');
      }
      throw new Error(d2.err_msg || 'Baidu STT token refresh failed');
    }

    throw new Error(d.err_msg || 'Baidu STT error: ' + d.err_no);
  }

  // ── Public API ───────────────────────────────
  /**
   * Recognize speech from an audio blob using the best available backend.
   * @param {Blob} audioBlob — webm/opus or wav audio blob
   * @param {string} dialectCode — e.g. 'sichuan', 'cantonese', 'shanghai'
   * @returns {Promise<string>} recognized text
   */
  async function recognize(audioBlob, dialectCode) {
    const dialect = DIALECTS[dialectCode];
    if (!dialect) throw new Error('Unknown dialect: ' + dialectCode);

    const cfg = getConfig();

    // Try Baidu first (simpler API)
    if (dialect.baiduPid && cfg.baiduApiKey && cfg.baiduSecretKey) {
      return await baiduRecognize(audioBlob, dialect.baiduPid);
    }

    // TODO: iFlytek fallback (WebSocket with HMAC-SHA256)
    // if (dialect.iflytekAccent && cfg.iflytekAppId) { ... }

    if (dialect.note) {
      throw new Error(dialect.note);
    }

    throw new Error('请先配置百度语音识别API Key');
  }

  // ── Helpers ──────────────────────────────────
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Remove data:... prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  return {
    DIALECTS,
    getConfig,
    saveConfig,
    isConfigured,
    recognize,
  };
})();
