/**
 * Translator module — language detection & text translation.
 * Dual backend: MyMemory (primary) + Google Translate (fallback).
 */

const Translator = (() => {

  // ── Language metadata ────────────────────────
  const LANG_META = {
    'zh-CN': { name: '中文普通话', iso: 'zh' },
    'zh-HK': { name: '粤语', iso: 'zh' },
    'zh-TW': { name: '中文台湾', iso: 'zh' },
    'en-US': { name: 'English', iso: 'en' },
    'ja-JP': { name: '日本語', iso: 'ja' },
    'ko-KR': { name: '한국어', iso: 'ko' },
    'fr-FR': { name: 'Français', iso: 'fr' },
    'es-ES': { name: 'Español', iso: 'es' },
    'de-DE': { name: 'Deutsch', iso: 'de' },
    'it-IT': { name: 'Italiano', iso: 'it' },
    'pt-BR': { name: 'Português', iso: 'pt' },
    'ru-RU': { name: 'Русский', iso: 'ru' },
    'ar-SA': { name: 'العربية', iso: 'ar' },
    'th-TH': { name: 'ไทย', iso: 'th' },
    'vi-VN': { name: 'Tiếng Việt', iso: 'vi' },
    'hi-IN': { name: 'हिन्दी', iso: 'hi' },
    'nl-NL': { name: 'Nederlands', iso: 'nl' },
    'tr-TR': { name: 'Türkçe', iso: 'tr' },
    // ISO-only entries (for target languages)
    'en': { name: 'English', iso: 'en' },
    'ja': { name: '日本語', iso: 'ja' },
    'ko': { name: '한국어', iso: 'ko' },
    'fr': { name: 'Français', iso: 'fr' },
    'es': { name: 'Español', iso: 'es' },
    'de': { name: 'Deutsch', iso: 'de' },
    'it': { name: 'Italiano', iso: 'it' },
    'pt': { name: 'Português', iso: 'pt' },
    'ru': { name: 'Русский', iso: 'ru' },
    'ar': { name: 'العربية', iso: 'ar' },
    'th': { name: 'ไทย', iso: 'th' },
    'vi': { name: 'Tiếng Việt', iso: 'vi' },
    'hi': { name: 'हिन्दी', iso: 'hi' },
    'nl': { name: 'Nederlands', iso: 'nl' },
    'tr': { name: 'Türkçe', iso: 'tr' },
  };

  // ── Character-based language detection ───────
  function detectLanguage(text) {
    if (!text || !text.trim()) return null;
    const s = text.trim();

    let cjk = 0, hiragana = 0, katakana = 0, hangul = 0, latin = 0,
        cyrillic = 0, arabic = 0, thai = 0, devanagari = 0;

    for (const ch of s) {
      const c = ch.codePointAt(0);
      if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) cjk++;
      else if (c >= 0x3040 && c <= 0x309F) hiragana++;
      else if (c >= 0x30A0 && c <= 0x30FF) katakana++;
      else if (c >= 0xAC00 && c <= 0xD7AF) hangul++;
      else if (c >= 0x0400 && c <= 0x04FF) cyrillic++;
      else if (c >= 0x0600 && c <= 0x06FF) arabic++;
      else if (c >= 0x0E00 && c <= 0x0E7F) thai++;
      else if (c >= 0x0900 && c <= 0x097F) devanagari++;
      else if ((c >= 0x0041 && c <= 0x005A) || (c >= 0x0061 && c <= 0x007A)) latin++;
    }

    const total = cjk + hiragana + katakana + hangul + latin + cyrillic + arabic + thai + devanagari;
    if (total === 0) return null;

    // Distinctive scripts — high confidence
    if (thai / total > 0.3)       return 'th-TH';
    if (arabic / total > 0.3)     return 'ar-SA';
    if (devanagari / total > 0.3) return 'hi-IN';
    if (cyrillic / total > 0.3)   return 'ru-RU';

    // CJK-family differentiation
    if (cjk / total > 0.3) {
      if ((hiragana + katakana) / total > 0.15) return 'ja-JP';
      return 'zh-CN'; // Chinese (simplified/traditional)
    }
    if (hangul / total > 0.3)     return 'ko-KR';
    if ((hiragana + katakana) / total > 0.2) return 'ja-JP';

    // Latin script — could be en/fr/es/de/it/pt/vi/nl/tr
    // Can't reliably distinguish without NLP. Default to English.
    if (latin / total > 0.5)      return 'en-US';

    return null;
  }

  // ISO → BCP-47 speech synthesis code (for TTS)
  const SPEECH_LANG = {
    'en': 'en-US', 'zh-CN': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR',
    'fr': 'fr-FR', 'es': 'es-ES', 'de': 'de-DE', 'it': 'it-IT',
    'pt': 'pt-BR', 'ru': 'ru-RU', 'ar': 'ar-SA', 'th': 'th-TH',
    'vi': 'vi-VN', 'hi': 'hi-IN', 'nl': 'nl-NL', 'tr': 'tr-TR',
  };

  // BCP-47 → ISO (reverse of SPEECH_LANG, for language swap)
  const SPEECH_TO_ISO = {
    'en-US': 'en', 'zh-CN': 'zh-CN', 'ja-JP': 'ja', 'ko-KR': 'ko',
    'fr-FR': 'fr', 'es-ES': 'es', 'de-DE': 'de', 'it-IT': 'it',
    'pt-BR': 'pt', 'ru-RU': 'ru', 'ar-SA': 'ar', 'th-TH': 'th',
    'vi-VN': 'vi', 'hi-IN': 'hi', 'nl-NL': 'nl', 'tr-TR': 'tr',
  };

  function getLangName(code) {
    return (LANG_META[code] && LANG_META[code].name) || code;
  }

  function toLangCode(code) {
    if (!code || code.startsWith('dialect:')) return 'zh'; // dialects default to Chinese
    return (LANG_META[code] && LANG_META[code].iso) || code.split('-')[0];
  }

  function getSpeechLang(code) {
    return SPEECH_LANG[code] || 'en-US';
  }

  // ── Translation ──────────────────────────────
  async function translate(text, sourceLang, targetLang) {
    if (!text || !text.trim()) return '';
    const from = toLangCode(sourceLang);
    const to = toLangCode(targetLang);
    if (from === to) return text;

    // Offline-first: use local NLLB-200 model if available
    if (typeof OfflineEngine !== 'undefined' && OfflineEngine.isModelReady('translation')) {
      try {
        const result = await OfflineEngine.translateOffline(text, sourceLang, targetLang);
        if (result) return result;
      } catch (e) {
        console.warn('[Translator] Offline translation failed, falling back to online:', e.message);
      }
    }

    // Try primary + fallback, retry up to 2 times total
    for (let attempt = 0; attempt < 2; attempt++) {
      // MyMemory (free, no key)
      try {
        const r = await mymemory(text, from, to);
        if (r) return r;
      } catch (_) { /* fall through */ }

      // Google Translate (unofficial, fallback)
      try {
        const r = await googletr(text, from, to);
        if (r) return r;
      } catch (_) { /* fall through */ }

      if (attempt < 1) {
        // Brief wait before retry
        await new Promise(r => setTimeout(r, 600));
      }
    }

    return '[翻译失败: ' + text + ']';
  }

  async function mymemory(text, from, to) {
    const u = 'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(text) + '&langpair=' + from + '|' + to;
    const r = await fetch(u);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.responseStatus === 200 || d.responseStatus === 403) {
      return d.responseData.translatedText || '';
    }
    throw new Error('status ' + d.responseStatus);
  }

  async function googletr(text, from, to) {
    const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
      from + '&tl=' + to + '&dt=t&q=' + encodeURIComponent(text);
    const r = await fetch(u);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d && d[0]) return d[0].map(s => s[0]).join('');
    throw new Error('empty');
  }

  return { detectLanguage, getLangName, translate, toLangCode, getSpeechLang, speechToIso: (c) => SPEECH_TO_ISO[c] || c.split('-')[0], LANG_META };
})();
