/**
 * Letterboxd + qBittorrent Search - Options Page Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('options-form');
  const baseUrlInput = document.getElementById('baseUrl');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const maxResultsInput = document.getElementById('maxResults');
  const queryTemplateInput = document.getElementById('queryTemplate');
  const searchPluginsInput = document.getElementById('searchPlugins');
  const searchCategoryInput = document.getElementById('searchCategory');
  const addCategoryInput = document.getElementById('addCategory');
  const addTagsInput = document.getElementById('addTags');
  const btnSave = document.getElementById('btn-save');
  const btnText = document.getElementById('btn-text');
  const btnIcon = document.getElementById('btn-icon');
  const statusAlert = document.getElementById('status-alert');

  function showStatus(message, type = 'success') {
    statusAlert.className = `status-alert ${type}`;
    statusAlert.textContent = message;
    statusAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setLoading(loading) {
    btnSave.disabled = loading;
    if (loading) {
      btnIcon.innerHTML = '<div class="spinner"></div>';
      btnText.textContent = 'Testando conexão e salvando...';
    } else {
      btnIcon.textContent = '✓';
      btnText.textContent = 'Testar Conexão & Salvar';
    }
  }

  // Load existing settings
  try {
    const data = await chrome.storage.local.get('qbit_settings');
    const settings = data.qbit_settings || {};

    if (settings.baseUrl) baseUrlInput.value = settings.baseUrl;
    if (settings.username) usernameInput.value = settings.username;
    if (settings.maxResults) maxResultsInput.value = settings.maxResults;
    if (settings.queryTemplate) queryTemplateInput.value = settings.queryTemplate;
    if (settings.searchPlugins) searchPluginsInput.value = settings.searchPlugins;
    if (settings.searchCategory) searchCategoryInput.value = settings.searchCategory;
    if (settings.addCategory) addCategoryInput.value = settings.addCategory;
    if (settings.addTags) addTagsInput.value = settings.addTags;

    if (settings.saveMode) {
      const radio = document.querySelector(`input[name="saveMode"][value="${settings.saveMode}"]`);
      if (radio) radio.checked = true;
    }

    // Try to restore session password if present
    if (chrome.storage.session) {
      const sessionData = await chrome.storage.session.get('qbit_session_password');
      if (sessionData.qbit_session_password) {
        passwordInput.value = sessionData.qbit_session_password;
      }
    }
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }

  // Form submission handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusAlert.style.display = 'none';

    let rawUrl = baseUrlInput.value.trim().replace(/\/+$/, '');
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      showStatus('A URL base deve iniciar com "http://" ou "https://"', 'error');
      return;
    }

    let parsedOrigin;
    try {
      const parsed = new URL(rawUrl);
      parsedOrigin = parsed.origin;
    } catch {
      showStatus('URL inválida. Verifique o formato digitado.', 'error');
      return;
    }

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const saveMode = document.querySelector('input[name="saveMode"]:checked').value;
    const maxResults = Math.min(25, Math.max(1, parseInt(maxResultsInput.value, 10) || 5));
    const queryTemplate = queryTemplateInput.value;
    const searchPlugins = searchPluginsInput.value.trim() || 'enabled';
    const searchCategory = searchCategoryInput.value.trim() || 'all';
    const addCategory = addCategoryInput.value.trim();
    const addTags = addTagsInput.value.trim() || 'letterboxd';

    if (!password) {
      showStatus('Por favor, informe a senha de acesso ao qBittorrent.', 'error');
      return;
    }

    setLoading(true);

    try {
      // 1. Solicit dynamic host permission
      const originPattern = `${parsedOrigin}/*`;
      const granted = await chrome.permissions.request({
        origins: [originPattern],
      });

      if (!granted) {
        showStatus('Permissão negada. A extensão precisa de acesso à URL do qBittorrent para se conectar.', 'error');
        setLoading(false);
        return;
      }

      // 2. Dispatch connection test to background service worker
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        payload: {
          baseUrl: rawUrl,
          username,
          password,
          saveMode,
          settings: {
            maxResults,
            queryTemplate,
            searchPlugins,
            searchCategory,
            addCategory,
            addTags,
          },
        },
      });

      if (response && response.ok && response.data && response.data.success) {
        showStatus(`✓ Conectado com sucesso ao qBittorrent (${response.data.version})! Configurações salvas.`, 'success');
      } else {
        const errorMsg = response && response.error ? response.error : 'Erro desconhecido ao testar conexão.';
        showStatus(`Falha na conexão: ${errorMsg}`, 'error');
      }
    } catch (err) {
      console.error('Erro ao testar e salvar:', err);
      showStatus(`Erro inesperado: ${err.message || String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  });
});
