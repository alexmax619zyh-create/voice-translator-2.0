/**
 * Voice Translator App — v2 (robust speech recognition)
 *
 * Key fix: Chrome's continuous mode is unreliable.
 * Instead we use single-shot recognition and manually
 * restart after each utterance + translation + TTS cycle.
 */

const App = (() => {
  // ── DOM refs ────────────────────────────────
  const sourceLangSelect = document.getElementById('sourceLang');
  const targetLangSelect = document.getElementById('targetLang');
  const swapBtn = document.getElementById('swapBtn');
  const sourceTextEl = document.getElementById('sourceText');
  const targetTextEl = document.getElementById('targetText');
  const detectedLangEl = document.getElementById('detectedLang');
  const translateStatusEl = document.getElementById('translateStatus');
  const micBtn = document.getElementById('micBtn');
  const micStatusEl = document.getElementById('micStatus');
  const speakBtn = document.getElementById('speakBtn');
  const copySourceBtn = document.getElementById('copySourceBtn');
  const copyTargetBtn = document.getElementById('copyTargetBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyListEl = document.getElementById('historyList');
  const toastEl = document.getElementById('toast');
  const debugPanel = document.getElementById('debugPanel');
  const debugLogEl = document.getElementById('debugLog');
  const debugToggleBtn = document.getElementById('debugToggleBtn');
  const browserInfoEl = document.getElementById('browserInfo');
  const apiSettingsEl = document.getElementById('apiSettings');
  const apiCloseBtn = document.getElementById('apiCloseBtn');
  const apiSaveBtn = document.getElementById('apiSaveBtn');
  const apiStatusEl = document.getElementById('apiStatus');
  const baiduApiKeyEl = document.getElementById('baiduApiKey');
  const baiduSecretKeyEl = document.getElementById('baiduSecretKey');
  const textInputEl = document.getElementById('textInput');
  const textTranslateBtnEl = document.getElementById('textTranslateBtn');
  const offlineIndicatorEl = document.getElementById('offlineIndicator');
  const modelPanelEl = document.getElementById('modelPanel');
  const modelPanelToggleBtn = document.getElementById('modelPanelToggleBtn');
  const modelPanelCloseBtn = document.getElementById('modelPanelCloseBtn');
  const modelCardsEl = document.getElementById('modelCards');
  const modelStorageInfoEl = document.getElementById('modelStorageInfo');

  // ── State ────────────────────────────────────
  let recognition = null;
  let active = false;
  let listening = false;
  let speaking = false;
  let currentSourceText = '';
  let currentTargetText = '';
  let history = [];
  const debugLines = [];
  let mediaRecorder = null;
  let audioChunks = [];

  // ── Audio Meter ──────────────────────────────
  let audioCtx = null;
  let analyser = null;
  let meterInterval = null;
  let micStream = null;
  let availableMics = [];
  const meterBar = document.getElementById('meterBar');
  const meterLabel = document.getElementById('meterLabel');
  const micDeviceSelect = document.getElementById('micDeviceSelect');

  // Populate mic device dropdown
  async function populateMicList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
      // Need to get permission first to see device labels
      let tempStream = null;
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_) { /* permission not yet granted, will show IDs only */ }

      const devices = await navigator.mediaDevices.enumerateDevices();
      availableMics = devices.filter(d => d.kind === 'audioinput');

      dlog('info', `检测到 ${availableMics.length} 个麦克风设备`);
      micDeviceSelect.innerHTML = '<option value="">默认麦克风</option>';

      availableMics.forEach((m, i) => {
        const label = m.label || `麦克风 ${i + 1}`;
        dlog('info', `  麦克风${i + 1}: "${label}"`);
        const opt = document.createElement('option');
        opt.value = m.deviceId;
        opt.textContent = label.length > 25 ? label.substring(0, 22) + '...' : label;
        micDeviceSelect.appendChild(opt);
      });

      // Release temp stream
      if (tempStream) {
        tempStream.getTracks().forEach(t => t.stop());
        tempStream = null;
      }
    } catch (e) {
      dlog('warn', `枚举麦克风失败: ${e.message}`);
    }
  }

  micDeviceSelect.addEventListener('change', () => {
    dlog('info', `切换麦克风: ${micDeviceSelect.selectedOptions[0].textContent}`);
    stopAudioMeter();
    startAudioMeter();
  });

  async function startAudioMeter() {
    try {
      const constraints = { audio: true };
      const selectedId = micDeviceSelect.value;
      if (selectedId) {
        constraints.audio = { deviceId: { exact: selectedId } };
      }

      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(d => d.kind === 'audioinput');
        availableMics = mics;
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStream = stream;
      dlog('success', 'getUserMedia 成功 — 麦克风已授权');

      // Show which mic is active
      const track = stream.getAudioTracks()[0];
      if (track) {
        dlog('success', `当前使用: "${track.label}"`);
      }

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let hasEverDetectedSound = false;

      meterInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const level = Math.min(100, Math.round((avg / 128) * 100));
        meterBar.style.width = level + '%';
        meterBar.classList.add('active');

        if (level >= 5 && !hasEverDetectedSound) {
          hasEverDetectedSound = true;
          dlog('success', `✅ 检测到声音信号！音量 ${level}%`);
        }

        if (level < 5) {
          meterLabel.textContent = '麦克风音量 (无声 — 请说话)';
        } else if (level < 25) {
          meterLabel.textContent = `麦克风音量 🔊 ${level}%`;
        } else {
          meterLabel.textContent = `麦克风音量 🔊🔊 ${level}%`;
        }
      }, 80);

      dlog('success', '音频分析器已启动 — 请说话观察音量条');
    } catch (e) {
      dlog('error', `getUserMedia 失败: ${e.name} — ${e.message}`);
      meterLabel.textContent = '❌ 麦克风被拒绝/不可用';
      meterBar.style.width = '0%';

      if (e.name === 'NotAllowedError') {
        dlog('error', '🔴 麦克风权限被拒绝！');
        dlog('error', '→ 点击 Edge 地址栏左侧的 🔒 锁图标');
        dlog('error', '→ 找到"麦克风" → 选择"允许"');
        dlog('error', '→ 然后刷新页面');
        showToast('请在地址栏左侧点击锁图标→允许麦克风→刷新');
      } else if (e.name === 'NotFoundError') {
        dlog('error', '🔴 找不到麦克风设备！请检查麦克风是否插入');
        showToast('未检测到麦克风设备，请检查连接');
      } else if (e.name === 'NotReadableError') {
        dlog('error', '🔴 麦克风被其他应用占用中');
        showToast('麦克风被其他应用占用，请关闭其他程序');
      }
    }
  }

  function stopAudioMeter() {
    if (meterInterval) { clearInterval(meterInterval); meterInterval = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; analyser = null; }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    meterBar.style.width = '0%';
    meterBar.classList.remove('active');
    meterLabel.textContent = '麦克风音量';
  }

  // ── PWA Install ──────────────────────────────
  let deferredPrompt = null;

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(() => {
        dlog('success', 'Service Worker 已注册 (离线可用)');
      }).catch((e) => {
        dlog('warn', 'SW注册失败: ' + e.message);
      });
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show install button in header
    const btn = document.getElementById('installBtn');
    if (btn) {
      btn.style.display = 'flex';
      btn.onclick = installApp;
    }
    dlog('info', '📲 可以安装到桌面了！点击右上角 📲 按钮');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    dlog('success', '✅ App 已安装到桌面');
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = 'none';
  });

  function installApp() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((r) => {
        dlog('info', '安装结果: ' + r.outcome);
        deferredPrompt = null;
      });
    } else {
      showToast('请通过浏览器菜单安装：⋮ → 添加到主屏幕');
    }
  }

  // Expose for HTML onclick
  window.installApp = installApp;

  // ── Offline status & model panel ──────────────
  function updateOfflineStatus() {
    const hasTranslation = typeof OfflineEngine !== 'undefined' && OfflineEngine.hasAnyModel();
    const hasWhisper = typeof OfflineEngine !== 'undefined' && OfflineEngine.isModelReady('whisper');
    const online = navigator.onLine;

    let cls = 'offline-none';
    let icon = '🔴';
    let title = '在线模式 — 未下载离线模型';

    if (hasTranslation) {
      cls = 'offline-ready';
      icon = '🟢';
      title = '离线就绪 — 可完全离线使用';
    } else if (online) {
      cls = 'online';
      icon = '🟡';
      title = '在线模式 — 点击下方 📦 下载离线模型';
    }

    offlineIndicatorEl.className = 'offline-indicator ' + cls;
    offlineIndicatorEl.textContent = icon;
    offlineIndicatorEl.title = title;

    // Show model panel toggle hint when online but no model
    if (online && !hasTranslation) {
      modelPanelToggleBtn.style.display = '';
    }
  }

  async function renderModelCards() {
    if (typeof OfflineEngine === 'undefined') {
      modelCardsEl.innerHTML = '<div class="history-empty">浏览器不支持离线模型</div>';
      return;
    }

    // Show language pair models
    const models = Object.values(OfflineEngine.MODELS);
    const storageInfo = await OfflineEngine.getStorageInfo();

    // Show storage info with test button
    modelStorageInfoEl.innerHTML =
      `📊 存储: 已用 ${storageInfo.usedMB}MB / 共 ${storageInfo.quotaMB}MB · 可用 ${storageInfo.availableMB}MB ` +
      `<button id="testCdnBtn" style="font-size:11px;padding:2px 8px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;margin-left:8px;">🔍 测速</button>` +
      `<div style="font-size:10px;color:#999;margin-top:4px;">模型文件需先放入 models/ 目录再上传 GitHub Pages</div>`;

    modelCardsEl.innerHTML = models
      .map(m => {
        const isReady = OfflineEngine.isModelReady(m.id);
        const dlState = OfflineEngine.getDownloadState(m.id);
        const isDownloading = dlState && dlState.status === 'downloading';
        const isLoading = dlState && dlState.status === 'loading';
        const percent = dlState ? (dlState.percent || 0) : 0;
        const inProgress = isDownloading || isLoading;

        return `
          <div class="model-card ${isReady ? 'ready' : ''}" data-model="${m.id}">
            <span class="model-icon">${m.id === 'translation' ? '🌐' : '🎙️'}</span>
            <div class="model-info">
              <div class="model-name">${m.name}</div>
              <div class="model-desc">${m.desc}</div>
              <div class="model-size">📦 ${m.sizeLabel}</div>
              <div class="model-progress ${inProgress ? 'active' : ''}">
                <div class="model-progress-bar" style="width:${percent}%"></div>
              </div>
              <div class="model-progress-text ${inProgress ? 'active' : ''}">
                ${isDownloading ? '下载中 ' + percent + '%' : isLoading ? '加载模型...' : ''}
              </div>
            </div>
            <div class="model-actions">
              ${isReady
                ? '<button class="model-btn delete" data-action="delete" data-model="' + m.id + '">删除</button>'
                : inProgress
                  ? '<button class="model-btn download" disabled>下载中...</button>'
                  : '<button class="model-btn download" data-action="download" data-model="' + m.id + '">下载</button>'
              }
            </div>
          </div>`;
      }).join('');

    // Bind download / delete buttons
    modelCardsEl.querySelectorAll('[data-action="download"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.model;
        const model = OfflineEngine.MODELS[modelId];
        if (!model) return;

        btn.disabled = true;
        btn.textContent = '准备中...';

        try {
          await OfflineEngine.downloadModel(modelId, (progress) => {
            // Re-render card to update progress bar
            renderModelCards();
          });
          showToast(model.name + ' 下载完成！可离线使用');
          updateOfflineStatus();
          if (modelPanelEl.style.display === 'block') renderModelCards();
        } catch (e) {
          showToast('下载失败: ' + e.message);
          dlog('error', 'Model download failed: ' + e.message);
        }
      });
    });

    modelCardsEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modelId = btn.dataset.model;
        if (confirm('确定要删除已下载的模型吗？')) {
          OfflineEngine.deleteModel(modelId);
          updateOfflineStatus();
          renderModelCards();
          showToast('模型已删除');
        }
      });
    });

    // CDN connectivity test button
    const testBtn = document.getElementById('testCdnBtn');
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = '⏳ 检测中...';
        try {
          const results = await OfflineEngine.testMirror();
          const summary = Object.entries(results)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' | ');
          dlog('info', 'CDN 测速: ' + summary);
          showToast(summary);
        } catch (e) {
          dlog('error', '测速失败: ' + e.message);
        }
        testBtn.disabled = false;
        testBtn.textContent = '🔍 测速';
      });
    }
  }

  function initModelPanel() {
    modelPanelToggleBtn.addEventListener('click', async () => {
      const open = modelPanelEl.style.display !== 'block';
      modelPanelEl.style.display = open ? 'block' : 'none';
      modelPanelToggleBtn.style.display = open ? 'none' : '';
      if (open) await renderModelCards();
    });

    modelPanelCloseBtn.addEventListener('click', () => {
      modelPanelEl.style.display = 'none';
      modelPanelToggleBtn.style.display = '';
    });

    // Listen for online/offline events
    window.addEventListener('online', () => {
      updateOfflineStatus();
      dlog('info', '🌐 网络已连接');
    });
    window.addEventListener('offline', () => {
      updateOfflineStatus();
      dlog('warn', '⚠️ 网络已断开 — ' + (OfflineEngine.hasAnyModel() ? '离线模型可用' : '翻译功能将不可用'));
      if (!OfflineEngine.hasAnyModel()) {
        showToast('网络断开且未下载离线模型，翻译不可用');
      }
    });
  }

  function checkOfflineCapabilities() {
    if (typeof OfflineEngine === 'undefined') {
      dlog('warn', '离线引擎不可用');
      return;
    }

    const chromeVer = OfflineEngine.getChromeVersion();
    dlog('info', `Chrome 版本: ${chromeVer}`);

    if (OfflineEngine.supportsLocalSpeechRecognition()) {
      dlog('success', '✅ Chrome 139+ 支持离线语音识别 (processLocally)');
    } else {
      dlog('info', '离线语音识别需 Chrome 139+ 或下载 Whisper 模型');
    }

    // Check storage
    OfflineEngine.getStorageInfo().then(info => {
      dlog('info', `存储: 可用 ${info.availableMB}MB / 共 ${info.quotaMB}MB`);
    });
  }

  // ── Init ─────────────────────────────────────
  function init() {
    // Hide browser warning if already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      document.getElementById('browserWarning').style.display = 'none';
      dlog('info', '以独立App模式运行');
    }
    detectBrowser();
    loadHistory();
    renderHistory();
    checkSupport();
    checkOfflineCapabilities();
    bindEvents();
    initModelPanel();
    registerSW();
    updateOfflineStatus();
    populateMicList().then(() => startAudioMeter());
    dlog('info', 'App 初始化完成');
    dlog('info', '💡 请对着麦克风说话，观察下方音量条是否跳动');
    dlog('info', '💡 如果音量条不动，请尝试切换麦克风设备');
    dlog('info', '📦 点击"管理离线模型"下载后即可离线使用');
  }

  function detectBrowser() {
    const ua = navigator.userAgent;
    let name = '未知';
    let cls = 'warn';
    let hint = '';

    if (ua.includes('Edg/')) {
      name = 'Edge';
      cls = 'ok';
      hint = 'Edge 使用 Azure 语音服务，国内可用 ✅';
    } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
      name = 'Chrome';
      cls = 'warn';
      hint = 'Chrome 走 Google 服务，国内可能被墙 ⚠️';
    } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
      name = 'Safari';
      cls = 'warn';
    } else if (ua.includes('Firefox/')) {
      name = 'Firefox';
      cls = 'error';
      hint = 'Firefox 不支持 Web Speech API ❌';
    }

    const proto = location.protocol;
    browserInfoEl.textContent = `${name} | ${proto}`;
    browserInfoEl.className = `debug-badge ${cls}`;
    dlog('info', `浏览器: ${name}, 协议: ${proto}`);
    if (hint) dlog(cls === 'ok' ? 'success' : 'warn', hint);

    if (proto === 'file:') {
      dlog('error', '❌ file:// 协议不支持语音识别！');
      dlog('warn', '请双击 启动翻译助手.vbs 启动服务器');
      micStatusEl.textContent = '❌ 请通过 HTTP 服务器打开页面';
      micStatusEl.style.color = '#EF4444';
      micBtn.disabled = true;
      showBrowserWarning('file-warn',
        '需要通过 HTTP 服务器打开',
        '双击文件直接打开无法使用语音识别。请双击 启动翻译助手.vbs 启动服务器');
    } else if (name === 'Chrome') {
      dlog('warn', '建议换用 Edge 浏览器（国内语音识别更稳定）');
      micStatusEl.textContent = '⚠️ 推荐使用 Edge 浏览器';
      micStatusEl.style.color = '#F59E0B';
      showBrowserWarning('browser-hint',
        '推荐使用 Edge 浏览器',
        'Chrome 语音识别走 Google 服务器，国内可能不可用。Edge 使用 Azure，国内更稳定。');
    }
  }

  function checkSupport() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      micBtn.disabled = true;
      micStatusEl.textContent = '⚠️ 浏览器不支持语音识别';
      micStatusEl.style.color = '#EF4444';
      dlog('error', 'SpeechRecognition API 不可用!');
      dlog('warn', '请使用 Chrome 或 Edge 打开此页面');
    } else {
      dlog('success', 'SpeechRecognition API ✓');
    }

    if (window.speechSynthesis) {
      dlog('success', 'SpeechSynthesis API ✓');
    } else {
      dlog('warn', 'SpeechSynthesis 不可用');
    }

    // Check if we can enumerate devices (indirect mic check)
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const hasMic = devices.some(d => d.kind === 'audioinput');
        dlog(hasMic ? 'success' : 'warn',
          hasMic ? '检测到麦克风设备' : '未检测到麦克风设备 — 请确认麦克风已连接');
      }).catch(() => {
        dlog('warn', '无法枚举音频设备（需要 HTTPS 或 localhost）');
      });
    }
  }

  function bindEvents() {
    micBtn.addEventListener('click', toggleMic);
    swapBtn.addEventListener('click', swapLanguages);
    speakBtn.addEventListener('click', () => {
      if (currentTargetText) speakAsync(currentTargetText, targetLangSelect.value);
    });
    copySourceBtn.addEventListener('click', () => copyText(currentSourceText, '源文本'));
    copyTargetBtn.addEventListener('click', () => copyText(currentTargetText, '翻译结果'));
    clearHistoryBtn.addEventListener('click', clearHistory);
    sourceLangSelect.addEventListener('change', onSourceLangChange);
    textInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') translateTypedText(); });
    textTranslateBtnEl.addEventListener('click', translateTypedText);
    apiCloseBtn.addEventListener('click', () => { apiSettingsEl.style.display = 'none'; });
    apiSaveBtn.addEventListener('click', saveApiConfig);
    debugToggleBtn.addEventListener('click', () => {
      const collapsed = debugLogEl.style.display === 'none';
      debugLogEl.style.display = collapsed ? '' : 'none';
      debugToggleBtn.textContent = collapsed ? '▾' : '▸';
    });
    loadApiConfig();
  }

  // ── Dialect helpers ──────────────────────────
  function isDialectMode() {
    return sourceLangSelect.value.startsWith('dialect:');
  }

  function getDialectCode() {
    if (!isDialectMode()) return null;
    return sourceLangSelect.value.replace('dialect:', '');
  }

  function loadApiConfig() {
    const cfg = CloudSTT.getConfig();
    if (cfg.baiduApiKey) baiduApiKeyEl.value = cfg.baiduApiKey;
    if (cfg.baiduSecretKey) baiduSecretKeyEl.value = cfg.baiduSecretKey;
  }

  function saveApiConfig() {
    const cfg = {
      baiduApiKey: baiduApiKeyEl.value.trim(),
      baiduSecretKey: baiduSecretKeyEl.value.trim(),
    };
    CloudSTT.saveConfig(cfg);
    apiStatusEl.textContent = '✅ 已保存';
    apiStatusEl.className = 'api-status ok';
    setTimeout(() => { apiStatusEl.textContent = ''; }, 2000);
    dlog('success', 'API配置已保存');
  }

  function checkDialectReady() {
    if (!isDialectMode()) return true;
    const dialect = getDialectCode();
    const info = CloudSTT.DIALECTS[dialect];
    if (!info) return false;
    if (info.baiduPid && CloudSTT.isConfigured('baidu')) return true;
    // Show API settings
    apiSettingsEl.style.display = 'block';
    apiStatusEl.textContent = info.note ? ('⚠️ ' + info.note) : '⚠️ 请先配置百度API';
    apiStatusEl.className = 'api-status error';
    dlog('warn', '方言模式需要配置云API');
    showToast('请先配置百度语音API Key');
    return false;
  }

  // ── Mic Toggle ───────────────────────────────
  function toggleMic() {
    if (active) {
      stop();
    } else {
      start();
    }
  }

  function start() {
    // Dialect mode: use MediaRecorder + cloud STT
    if (isDialectMode()) {
      if (!checkDialectReady()) return;
      startDialectRecording();
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast('请使用 Chrome 或 Edge 浏览器');
      return;
    }

    active = true;
    stopAudioMeter();
    micBtn.classList.add('listening');
    micBtn.querySelector('.mic-icon').textContent = '⏹️';
    micStatusEl.textContent = '🎤 正在聆听...';
    micStatusEl.style.color = '';

    dlog('info', 'START — 开始聆听循环');
    startOneRecognition();
  }

  // ── Dialect recording (MediaRecorder) ────────
  async function startDialectRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (!active) return;

        micStatusEl.textContent = '🔄 云端识别中...';
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

        try {
          const dialectCode = getDialectCode();
          const text = await CloudSTT.recognize(audioBlob, dialectCode);
          dlog('success', `方言识别结果: "${text}"`);
          if (text && text.trim()) {
            currentSourceText = text.trim();
            sourceTextEl.textContent = currentSourceText;
            processUtterance(currentSourceText);
          } else {
            dlog('warn', '方言识别未返回文本');
            micStatusEl.textContent = '⚠️ 未识别到语音，重试中...';
            if (active) setTimeout(() => startDialectRecording(), 500);
          }
        } catch (e) {
          dlog('error', `方言识别失败: ${e.message}`);
          if (e.message === 'baidu_not_configured') {
            apiSettingsEl.style.display = 'block';
            showToast('请先配置百度API Key');
          } else {
            showToast('识别失败: ' + e.message);
          }
          if (active) {
            micStatusEl.textContent = '🎤 重试中...';
            setTimeout(() => startDialectRecording(), 800);
          }
        }
      };

      mediaRecorder.start();
      active = true;
      stopAudioMeter();
      micBtn.classList.add('listening');
      micBtn.querySelector('.mic-icon').textContent = '⏹️';
      micStatusEl.textContent = '🔴 录音中 (方言)...';
      micStatusEl.style.color = '';

      dlog('info', '方言录音开始 — MediaRecorder');

    } catch (e) {
      dlog('error', `方言录音启动失败: ${e.message}`);
      showToast('无法启动录音: ' + e.message);
      active = false;
    }
  }

  function stopDialectRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }

  function stop() {
    active = false;
    listening = false;
    micBtn.classList.remove('listening');
    micBtn.querySelector('.mic-icon').textContent = '🎙️';
    micStatusEl.textContent = '点击开始录音';
    micStatusEl.style.color = '';

    // Stop dialect recording if active
    stopDialectRecording();
    mediaRecorder = null;

    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }

    // Cancel TTS
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    speaking = false;

    dlog('info', 'STOP — 完全停止');
    startAudioMeter(); // Restart meter for diagnostics
  }

  // ── Single recognition cycle ─────────────────
  function startOneRecognition() {
    if (!active) {
      dlog('info', '识别循环: 未激活，跳过');
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();

    // KEY: use single-shot mode — MUCH more reliable than continuous
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // Chrome 139+: enable on-device speech recognition (truly offline)
    if (typeof OfflineEngine !== 'undefined' && OfflineEngine.supportsLocalSpeechRecognition()) {
      try {
        rec.processLocally = true;
        dlog('info', '离线语音识别已启用 (processLocally)');
      } catch (_) {
        dlog('warn', 'processLocally 设置失败，使用云端识别');
      }
    }

    const srcLang = sourceLangSelect.value;
    if (srcLang !== 'auto') {
      rec.lang = srcLang;
      dlog('info', `语言设置: ${srcLang}`);
    } else {
      dlog('info', '语言: 自动 (浏览器默认)');
    }

    let finalTranscript = '';
    let hasHeardAnything = false;

    rec.onstart = () => {
      listening = true;
      dlog('success', '麦克风已激活 (onstart)');
      micStatusEl.textContent = '🎤 正在聆听...';
      sourceTextEl.textContent = '';
      sourceTextEl.classList.add('listening-indicator');
    };

    rec.onaudiostart = () => {
      dlog('success', '音频信号检测到 (onaudiostart)');
    };

    rec.onsoundstart = () => {
      dlog('success', '声音检测到 (onsoundstart)');
      hasHeardAnything = true;
      micStatusEl.textContent = '🔴 识别中...';
    };

    rec.onspeechstart = () => {
      dlog('success', '语音检测到 (onspeechstart)');
      micStatusEl.textContent = '🔴 识别中...';
    };

    rec.onresult = (event) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          finalTranscript += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }

      const display = finalTranscript + interim;
      dlog('info', `识别结果: "${display}" (最终: "${finalTranscript}")`);

      if (display) {
        sourceTextEl.textContent = display;
        sourceTextEl.classList.remove('listening-indicator');
      }
    };

    rec.onerror = (event) => {
      dlog('error', `识别错误: ${event.error} — ${event.message}`);

      if (event.error === 'not-allowed') {
        micStatusEl.textContent = '❌ 麦克风权限被拒绝';
        showToast('请在浏览器设置中允许麦克风权限');
        stop();
        return;
      }
      if (event.error === 'audio-capture') {
        micStatusEl.textContent = '❌ 无法访问麦克风';
        showToast('请检查麦克风是否连接');
        stop();
        return;
      }
      if (event.error === 'no-speech') {
        micStatusEl.textContent = '⚠️ 未检测到语音，重试中...';
      }
      if (event.error === 'network') {
        micStatusEl.textContent = '⚠️ 网络错误，重试中...';
      }
      // For other errors, we'll retry in onend
    };

    rec.onend = () => {
      listening = false;
      dlog('info', `识别结束 (onend) — 最终文本="${finalTranscript}", 激活=${active}, 听到声音=${hasHeardAnything}`);

      sourceTextEl.classList.remove('listening-indicator');

      if (!active) {
        // User stopped manually
        dlog('info', 'onend: 未激活状态，停止');
        recognition = null;
        return;
      }

      if (finalTranscript.trim()) {
        // Got speech! Process it
        currentSourceText = finalTranscript.trim();
        dlog('info', `开始处理: "${currentSourceText}"`);
        processUtterance(currentSourceText);
      } else if (!hasHeardAnything) {
        // No audio at all — maybe mic issue, retry slower
        micStatusEl.textContent = '⚠️ 未检测到声音，重试中...';
        recognition = null;
        setTimeout(() => {
          if (active) startOneRecognition();
        }, 500);
      } else {
        // Heard something but no final text — e.g. just noise, retry
        micStatusEl.textContent = '🎤 继续聆听...';
        recognition = null;
        startOneRecognition();
      }
    };

    recognition = rec;

    try {
      rec.start();
      dlog('success', 'recognition.start() 调用成功');
    } catch (e) {
      dlog('error', `recognition.start() 异常: ${e.message}`);
      listening = false;
      recognition = null;
      // Retry after a delay
      if (active) {
        setTimeout(() => {
          if (active) startOneRecognition();
        }, 1000);
      }
    }
  }

  // ── Process utterance ────────────────────────
  async function processUtterance(text) {
    if (!active) return;

    micStatusEl.textContent = '🔄 翻译中...';

    // 1. Detect language
    let detectedLang = sourceLangSelect.value;
    if (detectedLang === 'auto') {
      const d = Translator.detectLanguage(text);
      if (d) {
        detectedLang = d;
        detectedLangEl.textContent = `检测到: ${Translator.getLangName(d)}`;
      } else {
        detectedLang = 'zh-CN';
        detectedLangEl.textContent = '默认: 中文';
      }
    } else {
      detectedLangEl.textContent = '';
    }

    dlog('info', `检测到语言: ${detectedLang}`);

    // 2. Translate
    const targetLang = targetLangSelect.value;
    translateStatusEl.textContent = '⏳';
    translateStatusEl.classList.add('translating');

    let translation = '';
    try {
      translation = await Translator.translate(text, detectedLang, targetLang);
    } catch (e) {
      dlog('error', `翻译错误: ${e.message}`);
      translation = '[翻译失败，请重试]';
    }

    translateStatusEl.textContent = '↓';
    translateStatusEl.classList.remove('translating');

    currentTargetText = translation;
    targetTextEl.textContent = translation;

    dlog('success', `翻译结果: "${translation}"`);

    // 3. Save to history
    addToHistory(text, translation, detectedLang, targetLang);

    // 4. Speak the translation (only if still active)
    if (active && translation && !translation.startsWith('[翻译失败')) {
      micStatusEl.textContent = '🔊 朗读中...';
      speaking = true;
      await speakAsync(translation, targetLang);
      speaking = false;
    }

    // 5. Restart listening (if user hasn't stopped us)
    if (active) {
      dlog('info', '重新开始聆听循环');
      recognition = null;
      micStatusEl.textContent = '🎤 继续聆听...';
      if (isDialectMode()) {
        startDialectRecording();
      } else {
        startOneRecognition();
      }
    }
  }

  // ── TTS ──────────────────────────────────────
  function speakAsync(text, lang) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        dlog('warn', 'speakAsync: speechSynthesis 不可用');
        resolve();
        return;
      }

      // Chrome bug workaround: cancel + resume to prevent stale state
      window.speechSynthesis.cancel();

      // Wait briefly for cancel to take effect
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = Translator.getSpeechLang(lang);
        u.rate = 0.9;
        u.pitch = 1.0;
        u.volume = 1.0;

        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };

        u.onend = () => { dlog('info', 'TTS 朗读完成'); done(); };
        u.onerror = (e) => { dlog('warn', `TTS 错误: ${e.error}`); done(); };

        // Safety timeout (15s max for TTS)
        setTimeout(done, 15000);

        window.speechSynthesis.speak(u);
        dlog('info', `TTS 开始: "${text.substring(0, 30)}..."`);
      }, 100);
    });
  }

  // ── Text input translation ──────────────────
  async function translateTypedText() {
    const text = textInputEl.value.trim();
    if (!text) { showToast('请输入要翻译的文字'); return; }

    textTranslateBtnEl.disabled = true;
    textTranslateBtnEl.textContent = '⏳';

    // Show in source display
    currentSourceText = text;
    sourceTextEl.textContent = text;
    sourceTextEl.classList.remove('listening-indicator');

    // Detect language
    let detectedLang = sourceLangSelect.value;
    if (detectedLang === 'auto') {
      const d = Translator.detectLanguage(text);
      if (d) {
        detectedLang = d;
        detectedLangEl.textContent = '检测到: ' + Translator.getLangName(d);
      } else {
        detectedLang = 'zh-CN';
        detectedLangEl.textContent = '默认: 中文';
      }
    } else {
      detectedLangEl.textContent = '';
    }

    // Translate
    const targetLang = targetLangSelect.value;
    translateStatusEl.textContent = '⏳';
    translateStatusEl.classList.add('translating');

    let translation = '';
    try {
      translation = await Translator.translate(text, detectedLang, targetLang);
    } catch (e) {
      dlog('error', '翻译错误: ' + e.message);
      translation = '[翻译失败，请重试]';
    }

    translateStatusEl.textContent = '↓';
    translateStatusEl.classList.remove('translating');

    currentTargetText = translation;
    targetTextEl.textContent = translation;

    dlog('success', '翻译结果: "' + translation + '"');

    // Save to history
    addToHistory(text, translation, detectedLang, targetLang);

    textTranslateBtnEl.disabled = false;
    textTranslateBtnEl.textContent = '翻译';
  }

  // ── Language swap ───────────────────────────
  function swapLanguages() {
    const src = sourceLangSelect.value;
    const tgt = targetLangSelect.value;
    if (src === 'auto' || src.startsWith('dialect:')) {
      showToast('自动检测/方言模式下无法切换');
      return;
    }

    // Use Translator's centralized mappings
    sourceLangSelect.value = Translator.getSpeechLang(tgt);
    targetLangSelect.value = Translator.speechToIso(src);

    // Restart recognition with new lang
    if (active) {
      if (recognition) { try { recognition.abort(); } catch (_) {} recognition = null; }
      setTimeout(() => { if (active) startOneRecognition(); }, 200);
    }

    showToast('语言已切换');
  }

  function onSourceLangChange() {
    detectedLangEl.textContent = '';

    // Show API settings when dialect selected
    if (isDialectMode() && !checkDialectReady()) {
      // checkDialectReady already shows the settings panel
    } else {
      apiSettingsEl.style.display = 'none';
    }

    // Restart recording if active
    if (active) {
      if (isDialectMode()) {
        stopDialectRecording();
        setTimeout(() => { if (active) startDialectRecording(); }, 300);
      } else {
        if (recognition) { try { recognition.abort(); } catch (_) {} recognition = null; }
        setTimeout(() => { if (active) startOneRecognition(); }, 200);
      }
    }
  }

  // ── History ─────────────────────────────────
  function addToHistory(source, target, srcLang, tgtLang) {
    history.unshift({
      id: Date.now(),
      source, target,
      srcLang: Translator.getLangName(srcLang),
      tgtLang: Translator.getLangName(tgtLang),
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    });
    if (history.length > 50) history = history.slice(0, 50);
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    if (!history.length) {
      historyListEl.innerHTML = '<div class="history-empty">暂无翻译记录</div>';
      return;
    }
    historyListEl.innerHTML = history.map(e => `
      <div class="history-item" data-id="${e.id}">
        <div class="hi-source">${escapeHtml(e.source)}</div>
        <div class="hi-target">${escapeHtml(e.target)}</div>
        <div class="hi-time">${e.srcLang} → ${e.tgtLang} · ${e.time}</div>
      </div>
    `).join('');

    historyListEl.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const h = history.find(x => x.id === parseInt(el.dataset.id));
        if (h) {
          currentSourceText = h.source;
          currentTargetText = h.target;
          sourceTextEl.textContent = h.source;
          targetTextEl.textContent = h.target;
          showToast('已加载翻译记录');
        }
      });
    });
  }

  function clearHistory() {
    if (!history.length) return;
    if (confirm('确定要清空所有翻译记录吗？')) {
      history = [];
      saveHistory();
      renderHistory();
      showToast('翻译记录已清空');
    }
  }

  function loadHistory() {
    try { history = JSON.parse(localStorage.getItem('voice-translator-history') || '[]'); } catch (_) { history = []; }
  }

  function saveHistory() {
    try { localStorage.setItem('voice-translator-history', JSON.stringify(history)); } catch (_) {}
  }

  // ── Utilities ───────────────────────────────
  function copyText(text, label) {
    if (!text) { showToast('没有可复制的内容'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(`${label}已复制`))
        .catch(() => fallbackCopy(text, label));
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text, label) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(`${label}已复制`); } catch (_) { showToast('复制失败'); }
    document.body.removeChild(ta);
  }

  function showBrowserWarning(type, title, msg) {
    const el = document.getElementById('browserWarning');
    const titleEl = document.getElementById('warningTitle');
    const msgEl = document.getElementById('warningMsg');
    if (!el) return;
    el.className = `browser-warning ${type}`;
    titleEl.textContent = title;
    msgEl.textContent = msg;
    el.style.display = 'flex';
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._tid);
    toastEl._tid = setTimeout(() => toastEl.classList.remove('show'), 2000);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function dlog(level, msg) {
    const entry = { level, msg, time: Date.now() };
    debugLines.push(entry);
    if (debugLines.length > 50) debugLines.shift();
    console.log(`[VoiceTranslator][${level}] ${msg}`);
    renderDebugLog();
  }

  function renderDebugLog() {
    if (!debugLogEl) return;
    debugLogEl.innerHTML = debugLines.map(e =>
      `<div class="log-line ${e.level}">[${e.level}] ${escapeHtml(e.msg)}</div>`
    ).join('');
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }

  // ── Go ──────────────────────────────────────
  init();

  // Expose for debugging in console
  window.__translatorApp = {
    start, stop, toggleMic,
    getState: () => ({ active, listening, speaking }),
    history,
  };

  return { start, stop, toggleMic };
})();
