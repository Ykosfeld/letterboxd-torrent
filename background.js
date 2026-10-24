/**
 * Letterboxd + qBittorrent Search - Background Service Worker
 * Manifest V3 compatible
 */

const STORAGE_KEYS = {
  SETTINGS: 'qbit_settings',
  ENCRYPTED_AUTH: 'qbit_auth_enc',
  CRYPTO_KEY: 'qbit_crypto_jwk',
};

// In-memory active search tracking per tab
const activeSearchesByTab = new Map();

/* ==========================================================================
   1. WebCrypto Helper (AES-GCM 256-bit)
   ========================================================================== */

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getOrCreateCryptoKey() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CRYPTO_KEY);
  if (stored[STORAGE_KEYS.CRYPTO_KEY]) {
    try {
      return await crypto.subtle.importKey(
        'jwk',
        stored[STORAGE_KEYS.CRYPTO_KEY],
        { name: 'AES-GCM' },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (e) {
      console.warn('[Crypto] Failed to import existing key, generating new one:', e);
    }
  }

  const newKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const exported = await crypto.subtle.exportKey('jwk', newKey);
  await chrome.storage.local.set({ [STORAGE_KEYS.CRYPTO_KEY]: exported });
  return newKey;
}

async function encryptSecret(plainText) {
  const key = await getOrCreateCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(cipherBuffer),
  };
}

async function decryptSecret(encryptedObj) {
  if (!encryptedObj || !encryptedObj.iv || !encryptedObj.ciphertext) return '';
  const key = await getOrCreateCryptoKey();
  const iv = base64ToArrayBuffer(encryptedObj.iv);
  const data = base64ToArrayBuffer(encryptedObj.ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}

/* ==========================================================================
   2. Credentials & Settings Storage Management
   ========================================================================== */

async function getSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return res[STORAGE_KEYS.SETTINGS] || {
    baseUrl: '',
    username: '',
    saveMode: 'session', // 'session' | 'encrypted'
    maxResults: 5,
    searchPlugins: 'enabled',
    searchCategory: 'all',
    addCategory: '',
    addTags: 'letterboxd',
    queryTemplate: '{title} {year}',
  };
}

async function getPassword(saveMode) {
  if (saveMode === 'session') {
    if (chrome.storage.session) {
      const res = await chrome.storage.session.get('qbit_session_password');
      return res.qbit_session_password || '';
    }
    return '';
  }
  if (saveMode === 'encrypted') {
    const res = await chrome.storage.local.get(STORAGE_KEYS.ENCRYPTED_AUTH);
    if (res[STORAGE_KEYS.ENCRYPTED_AUTH]) {
      try {
        return await decryptSecret(res[STORAGE_KEYS.ENCRYPTED_AUTH]);
      } catch (e) {
        console.error('[Auth] Failed to decrypt saved password:', e);
        return '';
      }
    }
  }
  return '';
}

async function saveCredentials(settings, password) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });

  if (settings.saveMode === 'session') {
    // Clear encrypted disk storage
    await chrome.storage.local.remove(STORAGE_KEYS.ENCRYPTED_AUTH);
    if (chrome.storage.session) {
      await chrome.storage.session.set({ qbit_session_password: password });
    }
  } else if (settings.saveMode === 'encrypted') {
    // Clear session storage
    if (chrome.storage.session) {
      await chrome.storage.session.remove('qbit_session_password');
    }
    const encrypted = await encryptSecret(password);
    await chrome.storage.local.set({ [STORAGE_KEYS.ENCRYPTED_AUTH]: encrypted });
  }
}

/* ==========================================================================
   3. DeclarativeNetRequest (CORS / CSRF Header Rewriting)
   ========================================================================== */

async function updateDnrRules(baseUrl) {
  if (!baseUrl) return;
  try {
    const origin = new URL(baseUrl).origin;
    const ruleId = 1;

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
      addRules: [
        {
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: origin },
              { header: 'Referer', operation: 'set', value: `${origin}/` },
            ],
          },
          condition: {
            urlFilter: `${origin}/*`,
            resourceTypes: ['xmlhttprequest'],
          },
        },
      ],
    });
    console.log('[DNR] Updated Origin/Referer dynamic rule for:', origin);
  } catch (err) {
    console.error('[DNR] Failed to update dynamic rule:', err);
  }
}

// Sync DNR rules on worker initialization
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (settings.baseUrl) {
    await updateDnrRules(settings.baseUrl);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.baseUrl) {
    await updateDnrRules(settings.baseUrl);
  }
});

/* ==========================================================================
   4. qBittorrent Web API v2 Client
   ========================================================================== */

class QBitApi {
  constructor(baseUrl, username, password) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.username = username;
    this.password = password;
  }

  async request(endpoint, options = {}, isRetry = false) {
    if (!this.baseUrl) {
      throw new Error('URL do qBittorrent não configurada.');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const opts = {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    };

    let response;
    try {
      response = await fetch(url, opts);
    } catch (networkErr) {
      throw new Error(`Não foi possível conectar ao qBittorrent em ${this.baseUrl}: ${networkErr.message}`);
    }

    // 403 Forbidden indicates session expired or unauthenticated
    if (response.status === 403) {
      if (!isRetry) {
        console.log('[qBit] 403 recebido, tentando re-autenticar...');
        await this.login();
        return this.request(endpoint, options, true);
      }
      throw new Error('Acesso negado (403 Forbidden). Verifique usuário e senha.');
    }

    return response;
  }

  async login() {
    if (!this.baseUrl) {
      throw new Error('URL do qBittorrent não informada.');
    }
    const params = new URLSearchParams();
    params.append('username', this.username || '');
    params.append('password', this.password || '');

    const res = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      credentials: 'include',
    });

    if (!res.ok && res.status !== 403) {
      throw new Error(`Erro de login HTTP ${res.status}: ${res.statusText}`);
    }

    const text = await res.text();
    if (text.trim() === 'Fails.' || res.status === 403) {
      throw new Error('Credenciais incorretas (usuário ou senha inválidos).');
    }
    return true;
  }

  async getVersion() {
    const res = await this.request('/api/v2/app/version');
    if (!res.ok) throw new Error(`Falha ao obter versão: HTTP ${res.status}`);
    return await res.text();
  }

  async startSearch(pattern, plugins = 'enabled', category = 'all') {
    const params = new URLSearchParams();
    params.append('pattern', pattern);
    params.append('plugins', plugins || 'enabled');
    params.append('category', category || 'all');

    const res = await this.request('/api/v2/search/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro ao iniciar busca (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.id;
  }

  async getSearchStatus(searchId) {
    const res = await this.request(`/api/v2/search/status?id=${searchId}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) {
      return data[0] || null;
    }
    return data;
  }

  async getSearchResults(searchId, limit = 100) {
    const res = await this.request(`/api/v2/search/results?id=${searchId}&limit=${limit}&offset=0`);
    if (!res.ok) {
      throw new Error(`Erro ao buscar resultados: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.results || [];
  }

  async stopSearch(searchId) {
    try {
      const params = new URLSearchParams();
      params.append('id', String(searchId));
      await this.request('/api/v2/search/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (e) {
      console.warn('[qBit] Erro ao parar busca:', e);
    }
  }

  async deleteSearch(searchId) {
    try {
      const params = new URLSearchParams();
      params.append('id', String(searchId));
      await this.request('/api/v2/search/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (e) {
      console.warn('[qBit] Erro ao deletar busca:', e);
    }
  }

  async addTorrent(fileUrl, category = '', tags = '') {
    const params = new URLSearchParams();
    params.append('urls', fileUrl);
    if (category) params.append('category', category);
    if (tags) params.append('tags', tags);

    const res = await this.request('/api/v2/torrents/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha ao adicionar torrent (${res.status}): ${errText}`);
    }

    const text = await res.text();
    if (text.trim() === 'Fails.') {
      throw new Error('O qBittorrent rejeitou a adição do torrent.');
    }
    return true;
  }
}

/* ==========================================================================
   5. Search Polling Loop Orchestration
   ========================================================================== */

async function executeMovieSearch(tabId, query, settings, password) {
  const api = new QBitApi(settings.baseUrl, settings.username, password);

  // Stop & clean any existing search for this tab
  if (activeSearchesByTab.has(tabId)) {
    const oldId = activeSearchesByTab.get(tabId);
    activeSearchesByTab.delete(tabId);
    await api.stopSearch(oldId);
    await api.deleteSearch(oldId);
  }

  // Ensure authenticated
  await api.login();

  // Start new search
  const searchId = await api.startSearch(
    query,
    settings.searchPlugins || 'enabled',
    settings.searchCategory || 'all'
  );

  activeSearchesByTab.set(tabId, searchId);
  console.log(`[qBit] Busca iniciada id=${searchId} para query="${query}"`);

  const pollIntervalMs = 1200;
  const maxTimeoutMs = 15000;
  const startTime = Date.now();

  try {
    let finalStatus = 'Running';
    let totalFound = 0;

    while (Date.now() - startTime < maxTimeoutMs) {
      // Check if tab search was cancelled or replaced
      if (activeSearchesByTab.get(tabId) !== searchId) {
        throw new Error('Busca cancelada.');
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));

      const statusObj = await api.getSearchStatus(searchId);
      if (statusObj) {
        finalStatus = statusObj.status;
        totalFound = statusObj.total || 0;
        if (finalStatus === 'Stopped') {
          break;
        }
      }
    }

    // Stop search if still running
    if (finalStatus !== 'Stopped') {
      await api.stopSearch(searchId);
    }

    // Retrieve results
    const rawResults = await api.getSearchResults(searchId, 100);

    // Sort descending by nbSeeders
    rawResults.sort((a, b) => (b.nbSeeders || 0) - (a.nbSeeders || 0));

    // Slice top N
    const topN = rawResults.slice(0, Number(settings.maxResults) || 5);

    // Map strictly sanitized safe fields
    const sanitized = topN.map(item => ({
      fileName: String(item.fileName || ''),
      fileSize: Number(item.fileSize || 0),
      nbSeeders: Number(item.nbSeeders || 0),
      nbLeechers: Number(item.nbLeechers || 0),
      fileUrl: String(item.fileUrl || ''),
      descrLink: String(item.descrLink || ''),
      siteUrl: String(item.siteUrl || ''),
    }));

    return sanitized;
  } finally {
    // Guaranteed cleanup on server
    activeSearchesByTab.delete(tabId);
    await api.deleteSearch(searchId);
    console.log(`[qBit] Job de busca ${searchId} limpo no qBittorrent.`);
  }
}

/* ==========================================================================
   6. Clean up searches on Tab Close
   ========================================================================== */

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeSearchesByTab.has(tabId)) {
    const searchId = activeSearchesByTab.get(tabId);
    activeSearchesByTab.delete(tabId);
    try {
      const settings = await getSettings();
      const password = await getPassword(settings.saveMode);
      const api = new QBitApi(settings.baseUrl, settings.username, password);
      await api.stopSearch(searchId);
      await api.deleteSearch(searchId);
      console.log(`[qBit] Aba fechada: busca ${searchId} encerrada.`);
    } catch (e) {
      console.warn('[qBit] Erro ao limpar busca de aba fechada:', e);
    }
  }
});

/* ==========================================================================
   7. Message Listener (Options Page & Content Script Router)
   ========================================================================== */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : 'popup_or_options';

  // Handle asynchronously
  (async () => {
    switch (message.type) {
      case 'GET_CONFIG_STATUS': {
        const settings = await getSettings();
        const pass = await getPassword(settings.saveMode);
        const isConfigured = Boolean(settings.baseUrl && settings.username && pass);
        return {
          isConfigured,
          queryTemplate: settings.queryTemplate || '{title} {year}',
        };
      }

      case 'OPEN_OPTIONS': {
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        }
        return { success: true };
      }

      case 'TEST_CONNECTION': {
        const { baseUrl, username, password, saveMode, settings } = message.payload;
        await updateDnrRules(baseUrl);
        const api = new QBitApi(baseUrl, username, password);
        await api.login();
        const version = await api.getVersion();

        // Save settings & password if test succeeded
        const fullSettings = {
          ...settings,
          baseUrl: baseUrl.replace(/\/+$/, ''),
          username,
          saveMode,
        };
        await saveCredentials(fullSettings, password);

        return { success: true, version };
      }

      case 'SEARCH_MOVIE': {
        const { query } = message.payload;
        const settings = await getSettings();
        const password = await getPassword(settings.saveMode);

        if (!settings.baseUrl || !password) {
          throw new Error('qBittorrent não configurado nas opções da extensão.');
        }

        const results = await executeMovieSearch(tabId, query, settings, password);
        return { success: true, results };
      }

      case 'CANCEL_SEARCH': {
        if (activeSearchesByTab.has(tabId)) {
          const searchId = activeSearchesByTab.get(tabId);
          activeSearchesByTab.delete(tabId);
          const settings = await getSettings();
          const password = await getPassword(settings.saveMode);
          const api = new QBitApi(settings.baseUrl, settings.username, password);
          await api.stopSearch(searchId);
          await api.deleteSearch(searchId);
        }
        return { success: true };
      }

      case 'ADD_TORRENT': {
        let { fileUrl, descrLink } = message.payload;
        const settings = await getSettings();
        const password = await getPassword(settings.saveMode);

        if (!settings.baseUrl || !password) {
          throw new Error('qBittorrent não configurado.');
        }

        // If fileUrl is an HTML page (like LimeTorrents details page) or not a magnet link,
        // attempt to fetch the page and extract the real magnet link
        if (fileUrl && (/\.html?(\?.*)?$/i.test(fileUrl) || (!fileUrl.startsWith('magnet:') && !fileUrl.includes('.torrent')))) {
          try {
            const pageRes = await fetch(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (pageRes.ok) {
              const html = await pageRes.text();
              const magnetMatch = html.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^"'\s<>]*/i);
              if (magnetMatch) {
                fileUrl = magnetMatch[0];
                console.log('[qBit] Magnet link extraído com sucesso da página:', fileUrl);
              }
            }
          } catch (e) {
            console.warn('[qBit] Não foi possível fazer scraping direto do magnet:', e);
          }
        }

        // If it is still an HTML page, sending it to qBittorrent will fail with bdecode:4 error
        if (fileUrl && /\.html?(\?.*)?$/i.test(fileUrl)) {
          if (chrome.tabs && chrome.tabs.create) {
            await chrome.tabs.create({ url: fileUrl });
          }
          return {
            success: true,
            openedInTab: true,
            message: 'O indexador (ex: LimeTorrents) forneceu uma página web (.html) em vez de um link magnet/torrent direto.\n\nA página foi aberta em uma nova aba para você clicar no botão Magnet!',
          };
        }

        const api = new QBitApi(settings.baseUrl, settings.username, password);
        await api.addTorrent(
          fileUrl,
          settings.addCategory || '',
          settings.addTags || 'letterboxd'
        );
        return { success: true };
      }

      default:
        throw new Error(`Tipo de mensagem desconhecido: ${message.type}`);
    }
  })()
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => {
      console.error(`[Background] Erro processando ${message.type}:`, err);
      sendResponse({ ok: false, error: err.message || String(err) });
    });

  return true; // Keep channel open for async response
});
