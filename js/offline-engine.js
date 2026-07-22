/**
 * Offline Engine — local inference via transformers.js
 *
 * Translation: NLLB-200 distilled 600M (~242MB) — 200+ languages
 * ASR:        whisper-tiny (~120MB) — fallback for non-Chrome browsers
 *
 * Requires: <script type="importmap"> for @huggingface/transformers in index.html
 */

const OfflineEngine = (() => {

  // ── Model definitions ─────────────────────────
  const MODELS = {
    translation: {
      id: 'translation',
      name: '翻译模型 NLLB-200',
      desc: '支持 200+ 语言互译',
      modelId: 'Xenova/nllb-200-distilled-600M',
      task: 'translation',
      size: 242,
      sizeLabel: '~242 MB',
    },
    whisper: {
      id: 'whisper',
      name: '语音识别 Whisper',
      desc: '离线语音转文字（非 Chrome 浏览器备用）',
      modelId: 'onnx-community/whisper-tiny',
      task: 'automatic-speech-recognition',
      size: 120,
      sizeLabel: '~120 MB',
    },
  };

  // ── State ────────────────────────────────────
  let pipelineFn = null;            // cached transformers.js pipeline import
  let translationPipe = null;       // NLLB-200 pipeline instance
  let whisperPipe = null;           // whisper-tiny pipeline instance
  let downloadStates = {};          // per-model download progress

  // ── BCP-47 → FLORES-200 language codes ────────
  const BCP47_TO_FLORES = {
    'zh-CN': 'zho_Hans', 'zh-HK': 'yue_Hant', 'zh-TW': 'zho_Hant',
    'en-US': 'eng_Latn', 'ja-JP': 'jpn_Jpan', 'ko-KR': 'kor_Hang',
    'fr-FR': 'fra_Latn', 'es-ES': 'spa_Latn', 'de-DE': 'deu_Latn',
    'it-IT': 'ita_Latn', 'pt-BR': 'por_Latn', 'ru-RU': 'rus_Cyrl',
    'ar-SA': 'arb_Arab', 'th-TH': 'tha_Thai', 'vi-VN': 'vie_Latn',
    'hi-IN': 'hin_Deva', 'nl-NL': 'nld_Latn', 'tr-TR': 'tur_Latn',
    // ISO fallbacks (used in target language select)
    'zh': 'zho_Hans', 'en': 'eng_Latn', 'ja': 'jpn_Jpan',
    'ko': 'kor_Hang', 'fr': 'fra_Latn', 'es': 'spa_Latn',
    'de': 'deu_Latn', 'it': 'ita_Latn', 'pt': 'por_Latn',
    'ru': 'rus_Cyrl', 'ar': 'arb_Arab', 'th': 'tha_Thai',
    'vi': 'vie_Latn', 'hi': 'hin_Deva', 'nl': 'nld_Latn',
    'tr': 'tur_Latn',
  };

  // FLORES → human name
  const FLORES_NAMES = {
    'zho_Hans': '中文', 'eng_Latn': 'English', 'jpn_Jpan': '日本語',
    'kor_Hang': '한국어', 'fra_Latn': 'Français', 'spa_Latn': 'Español',
    'deu_Latn': 'Deutsch', 'ita_Latn': 'Italiano', 'por_Latn': 'Português',
    'rus_Cyrl': 'Русский', 'arb_Arab': 'العربية', 'tha_Thai': 'ไทย',
    'vie_Latn': 'Tiếng Việt', 'hin_Deva': 'हिन्दी', 'nld_Latn': 'Nederlands',
    'tur_Latn': 'Türkçe', 'yue_Hant': '粤语', 'zho_Hant': '中文繁体',
  };

  // ── Import transformers.js (lazy, cached) ─────
  async function getPipeline() {
    if (!pipelineFn) {
      const mod = await import('@huggingface/transformers');
      // Use Chinese mirror for fast model downloads in China.
      // Remove this line if you're deploying outside China.
      mod.env.remoteHost = 'https://hf-mirror.com';
      pipelineFn = mod.pipeline;
      console.log('[OfflineEngine] transformers.js loaded (mirror: hf-mirror.com)');
    }
    return pipelineFn;
  }

  // ── Model readiness ──────────────────────────
  function isModelReady(type) {
    if (type === 'translation') return !!translationPipe;
    if (type === 'whisper') return !!whisperPipe;
    return false;
  }

  function getDownloadState(type) {
    return downloadStates[type] || null;
  }

  // ── Download model ────────────────────────────
  async function downloadModel(type, onProgress) {
    const model = MODELS[type];
    if (!model) throw new Error('Unknown model type: ' + type);
    if (isModelReady(type)) {
      if (onProgress) onProgress({ status: 'ready' });
      return;
    }

    // Check storage space
    const info = await getStorageInfo();
    const needMB = model.size;
    if (info.availableMB < needMB + 50) {
      const msg = `存储空间不足！需要 ${needMB}MB，可用 ${info.availableMB}MB。请清理浏览器缓存后重试。`;
      if (onProgress) onProgress({ status: 'error', message: msg });
      throw new Error(msg);
    }

    downloadStates[type] = { status: 'downloading', loaded: 0, total: model.size * 1024 * 1024 };

    const pipe = await getPipeline();
    const instance = await pipe(model.task, model.modelId, {
      progress_callback: (p) => {
        if (p.status === 'downloading' && p.loaded && p.total) {
          downloadStates[type] = {
            status: 'downloading',
            loaded: p.loaded,
            total: p.total,
            percent: Math.round((p.loaded / p.total) * 100),
          };
        } else if (p.status === 'progress') {
          downloadStates[type] = {
            status: 'loading',
            percent: Math.round(p.progress || 0),
          };
        }
        if (onProgress) onProgress(downloadStates[type]);
      },
    });

    if (type === 'translation') translationPipe = instance;
    else if (type === 'whisper') whisperPipe = instance;

    downloadStates[type] = { status: 'ready' };
    if (onProgress) onProgress({ status: 'ready' });

    console.log('[OfflineEngine] Model ready:', model.name);
  }

  // ── Offline translation ──────────────────────
  async function translateOffline(text, sourceLang, targetLang) {
    if (!translationPipe) throw new Error('Translation model not loaded');

    const srcFlores = BCP47_TO_FLORES[sourceLang] || 'zho_Hans';
    const tgtFlores = BCP47_TO_FLORES[targetLang] || 'eng_Latn';

    if (srcFlores === tgtFlores) return text;

    const results = await translationPipe(text, {
      src_lang: srcFlores,
      tgt_lang: tgtFlores,
      max_new_tokens: 256,
    });

    // NLLB returns [{ translation_text: '...' }]
    if (Array.isArray(results) && results.length > 0) {
      return results[0].translation_text || text;
    }
    return text;
  }

  // ── Offline ASR (whisper) ────────────────────
  async function transcribeOffline(audioBlob, lang) {
    if (!whisperPipe) throw new Error('Whisper model not loaded');

    // whisper needs the audio as a URL or ArrayBuffer via pipeline input
    // Convert blob to a format the pipeline accepts
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Determine language (whisper uses ISO 639-1 codes)
    const whisperLang = {
      'zh-CN': 'zh', 'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko',
      'fr-FR': 'fr', 'es-ES': 'es', 'de-DE': 'de', 'it-IT': 'it',
      'pt-BR': 'pt', 'ru-RU': 'ru', 'ar-SA': 'ar', 'th-TH': 'th',
      'vi-VN': 'vi', 'hi-IN': 'hi', 'nl-NL': 'nl', 'tr-TR': 'tr',
    }[lang] || 'zh';

    const result = await whisperPipe(arrayBuffer, {
      language: whisperLang,
      task: 'transcribe',
    });

    return result?.text || '';
  }

  // ── Delete model ─────────────────────────────
  function deleteModel(type) {
    if (type === 'translation') {
      translationPipe = null;
      // transformers.js models are in browser cache — suggest user clears
    } else if (type === 'whisper') {
      whisperPipe = null;
    }
    downloadStates[type] = { status: 'not_downloaded' };
    // Force clear the pipeline's internal cache
    if (pipelineFn && pipelineFn.cache) {
      pipelineFn.cache.clear();
    }
    console.log('[OfflineEngine] Model disposed:', type);
  }

  // ── Storage info ─────────────────────────────
  async function getStorageInfo() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usedMB = Math.round((est.usage || 0) / (1024 * 1024));
        const quotaMB = Math.round((est.quota || 0) / (1024 * 1024));
        const availableMB = quotaMB - usedMB;
        return { usedMB, quotaMB, availableMB };
      } catch (_) {}
    }
    return { usedMB: 0, quotaMB: 0, availableMB: 9999 }; // unknown, assume ok
  }

  // ── Chrome version detection ─────────────────
  function getChromeVersion() {
    const m = navigator.userAgent.match(/Chrome\/(\d+)/);
    return m ? parseInt(m[1]) : 0;
  }

  function supportsLocalSpeechRecognition() {
    // Chrome 139+ supports processLocally for SpeechRecognition
    const cv = getChromeVersion();
    return cv >= 139;
  }

  // ── Public API ───────────────────────────────
  return {
    MODELS,
    isModelReady,
    getDownloadState,
    downloadModel,
    deleteModel,
    translateOffline,
    transcribeOffline,
    getStorageInfo,
    getFloresCode: (bcp47) => BCP47_TO_FLORES[bcp47] || 'eng_Latn',
    getFloresName: (code) => FLORES_NAMES[code] || code,
    supportsLocalSpeechRecognition,
    getChromeVersion,
  };
})();
