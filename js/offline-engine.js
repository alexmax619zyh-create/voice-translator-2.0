/**
 * Offline Engine — local inference via transformers.js
 *
 * Uses small OPUS-MT models (~50-90MB each) hosted on GitHub Pages
 * alongside the app. No external CDN needed after initial upload.
 *
 * Models are stored in: {origin}/models/{lang-pair}/
 * e.g.: https://user.github.io/voice-translator/models/zh-en/
 */

const OfflineEngine = (() => {

  // ── Language pair definitions ─────────────────
  // Each pair is an OPUS-MT model (one direction only).
  // Key: "src-tgt" (ISO codes), Model files go in: models/{key}/
  const PAIRS = {
    'zh-en': {
      id: 'zh-en', name: '中 → 英', from: 'zh', to: 'en',
      modelId: 'zh-en', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
    'en-zh': {
      id: 'en-zh', name: '英 → 中', from: 'en', to: 'zh',
      modelId: 'en-zh', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
    'en-ja': {
      id: 'en-ja', name: '英 → 日', from: 'en', to: 'ja',
      modelId: 'en-ja', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
    'en-ko': {
      id: 'en-ko', name: '英 → 韩', from: 'en', to: 'ko',
      modelId: 'en-ko', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
    'en-fr': {
      id: 'en-fr', name: '英 → 法', from: 'en', to: 'fr',
      modelId: 'en-fr', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
    'en-es': {
      id: 'en-es', name: '英 → 西', from: 'en', to: 'es',
      modelId: 'en-es', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
    'en-de': {
      id: 'en-de', name: '英 → 德', from: 'en', to: 'de',
      modelId: 'en-de', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
    'en-ru': {
      id: 'en-ru', name: '英 → 俄', from: 'en', to: 'ru',
      modelId: 'en-ru', task: 'translation', size: 80, sizeLabel: '~80 MB',
    },
  };

  // Legacy: expose as MODELS for UI compatibility
  const MODELS = {};
  for (const [key, p] of Object.entries(PAIRS)) {
    MODELS[key] = {
      id: key, name: p.name, desc: p.from + ' → ' + p.to,
      modelId: p.modelId, task: p.task, size: p.size, sizeLabel: p.sizeLabel,
    };
  }

  // ── State ────────────────────────────────────
  let pipelineFn = null;
  let pipes = {};           // key → pipeline instance
  let downloadStates = {};  // key → download progress

  // ── ISO code mapping (OPUS uses 2-letter codes) ─
  const BCP47_TO_ISO = {
    'zh-CN': 'zh', 'zh-HK': 'zh', 'zh-TW': 'zh',
    'en-US': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko',
    'fr-FR': 'fr', 'es-ES': 'es', 'de-DE': 'de',
    'it-IT': 'it', 'pt-BR': 'pt', 'ru-RU': 'ru',
    'ar-SA': 'ar', 'th-TH': 'th', 'vi-VN': 'vi',
    'hi-IN': 'hi', 'nl-NL': 'nl', 'tr-TR': 'tr',
  };

  function getModelBaseUrl() {
    // Models are co-located with the app on GitHub Pages
    const base = location.pathname.replace(/\/[^/]*$/, '') || '';
    return location.origin + base + '/models';
  }

  // ── Import transformers.js (lazy, cached) ─────
  async function getPipeline() {
    if (!pipelineFn) {
      const mod = await import('@huggingface/transformers');

      // WASM backend files from unpkg (the only CDN that works from China)
      mod.env.backends.onnx.wasm.wasmPaths =
        'https://unpkg.com/@huggingface/transformers@3/dist/';

      // Point model downloads to our own GitHub Pages (no external CDN!)
      mod.env.remoteHost = getModelBaseUrl();
      mod.env.remotePathTemplate = '{model}/{file}';
      // Disable HF token requirement for public models
      mod.env.useFSCache = false;

      console.log('[OfflineEngine] Configured — models:', mod.env.remoteHost);

      pipelineFn = mod.pipeline;
    }
    return pipelineFn;
  }

  // ── Model readiness ──────────────────────────
  function isModelReady(key) {
    return !!pipes[key];
  }

  function hasAnyModel() {
    return Object.values(pipes).some(p => !!p);
  }

  function getReadyPairs() {
    return Object.keys(pipes).filter(k => !!pipes[k]);
  }

  function getDownloadState(key) {
    return downloadStates[key] || null;
  }

  // ── Connectivity test ─────────────────────────
  async function testMirror() {
    const results = {};
    const base = getModelBaseUrl();
    const urls = {
      '本站(GitHub Pages)': base + '/zh-en/config.json',
      'unpkg CDN': 'https://unpkg.com/@huggingface/transformers@3/package.json',
    };
    for (const [name, url] of Object.entries(urls)) {
      const start = Date.now();
      try {
        const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
        const elapsed = Date.now() - start;
        results[name] = resp.ok
          ? `✅ ${(elapsed / 1000).toFixed(1)}s`
          : `❌ HTTP ${resp.status}`;
      } catch (e) {
        results[name] = '❌ ' + (e.name === 'TimeoutError' ? '超时' : '不通');
      }
    }
    return results;
  }

  // ── Download model (from self-hosted GitHub Pages) ──
  async function downloadModel(key, onProgress) {
    const pair = PAIRS[key];
    if (!pair) throw new Error('Unknown model: ' + key);
    if (isModelReady(key)) {
      if (onProgress) onProgress({ status: 'ready' });
      return;
    }

    // Check storage
    const info = await getStorageInfo();
    if (info.availableMB < pair.size + 50) {
      const msg = `存储空间不足！需要 ${pair.size}MB，可用 ${info.availableMB}MB。`;
      if (onProgress) onProgress({ status: 'error', message: msg });
      throw new Error(msg);
    }

    downloadStates[key] = { status: 'downloading', loaded: 0, total: pair.size * 1024 * 1024 };

    const pipe = await getPipeline();
    const configUrl = getModelBaseUrl() + '/' + pair.modelId + '/config.json';
    console.log('[OfflineEngine] Loading model, config URL:', configUrl);

    // Quick check: is the config file reachable?
    try {
      const testResp = await fetch(configUrl, { method: 'HEAD' });
      if (!testResp.ok) {
        throw new Error(`Config not reachable: HTTP ${testResp.status} — ${configUrl}`);
      }
      console.log('[OfflineEngine] Config file OK:', configUrl);
    } catch (e) {
      const msg = '模型文件访问失败: ' + configUrl + ' — ' + e.message;
      console.error('[OfflineEngine]', msg);
      downloadStates[key] = { status: 'error', message: msg };
      if (onProgress) onProgress({ status: 'error', message: msg });
      throw new Error(msg);
    }

    try {
      const instance = await pipe(pair.task, pair.modelId, {
        progress_callback: (p) => {
          if (p.status === 'downloading' && p.loaded && p.total) {
            downloadStates[key] = {
              status: 'downloading',
              loaded: p.loaded,
              total: p.total,
              percent: Math.round((p.loaded / p.total) * 100),
            };
          } else if (p.status === 'progress') {
            downloadStates[key] = {
              status: 'loading',
              percent: Math.round(p.progress || 0),
            };
          }
          if (onProgress) onProgress(downloadStates[key]);
        },
      });

      pipes[key] = instance;
      downloadStates[key] = { status: 'ready' };
      if (onProgress) onProgress({ status: 'ready' });
      console.log('[OfflineEngine] Model ready:', pair.name);
    } catch (e) {
      // If self-hosted fails, model files probably weren't uploaded yet
      const msg = '模型文件未找到。请先将模型文件上传到 GitHub Pages 的 models/' + key + ' 目录。';
      downloadStates[key] = { status: 'error', message: msg };
      if (onProgress) onProgress({ status: 'error', message: msg });
      throw new Error(msg);
    }
  }

  // ── Offline translation ──────────────────────
  async function translateOffline(text, sourceLang, targetLang) {
    const src = BCP47_TO_ISO[sourceLang] || sourceLang.split('-')[0];
    const tgt = BCP47_TO_ISO[targetLang] || targetLang.split('-')[0];

    if (src === tgt) return text;

    // Direct pair
    let key = src + '-' + tgt;
    if (pipes[key]) {
      const result = await pipes[key](text, { max_new_tokens: 256 });
      return (Array.isArray(result) && result[0]?.translation_text) || text;
    }

    // Pivot through English: src→en then en→tgt
    if (src !== 'en' && tgt !== 'en') {
      const toEn = src + '-en';
      const fromEn = 'en-' + tgt;
      if (pipes[toEn] && pipes[fromEn]) {
        const enText = await pipes[toEn](text, { max_new_tokens: 256 });
        const enStr = (Array.isArray(enText) && enText[0]?.translation_text) || text;
        const result = await pipes[fromEn](enStr, { max_new_tokens: 256 });
        return (Array.isArray(result) && result[0]?.translation_text) || enStr;
      }
    }

    throw new Error('No offline model for ' + key + '. Please download the language pair first.');
  }

  // ── Delete model ─────────────────────────────
  function deleteModel(key) {
    pipes[key] = null;
    downloadStates[key] = { status: 'not_downloaded' };
    console.log('[OfflineEngine] Model disposed:', key);
  }

  // ── Storage info ─────────────────────────────
  async function getStorageInfo() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usedMB = Math.round((est.usage || 0) / (1024 * 1024));
        const quotaMB = Math.round((est.quota || 0) / (1024 * 1024));
        return { usedMB, quotaMB, availableMB: quotaMB - usedMB };
      } catch (_) {}
    }
    return { usedMB: 0, quotaMB: 0, availableMB: 9999 };
  }

  // ── Chrome version detection ─────────────────
  function getChromeVersion() {
    const m = navigator.userAgent.match(/Chrome\/(\d+)/);
    return m ? parseInt(m[1]) : 0;
  }

  function supportsLocalSpeechRecognition() {
    return getChromeVersion() >= 139;
  }

  // ── Public API ───────────────────────────────
  return {
    MODELS,
    PAIRS,
    isModelReady,
    hasAnyModel,
    getReadyPairs,
    getDownloadState,
    downloadModel,
    deleteModel,
    translateOffline,
    getStorageInfo,
    testMirror,
    getModelBaseUrl,
    supportsLocalSpeechRecognition,
    getChromeVersion,
  };
})();
