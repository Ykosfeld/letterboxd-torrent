/**
 * Letterboxd + qBittorrent Search - Content Script
 * Manifest V3 compatible
 */

(() => {
  // Prevent duplicate execution on the same frame
  if (window.__letterboxd_qbit_loaded) return;
  window.__letterboxd_qbit_loaded = true;

  let currentFilmUrl = window.location.pathname;
  let currentSearchQuery = '';

  /* ==========================================================================
     1. Utility Functions
     ========================================================================== */

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  function extractBadges(fileName) {
    const badges = [];
    const name = String(fileName || '');

    if (/\b(4k|2160p|uhd)\b/i.test(name)) {
      badges.push({ text: '4K', class: 'badge-4k' });
    } else if (/\b(1080p)\b/i.test(name)) {
      badges.push({ text: '1080p', class: 'badge-1080p' });
    } else if (/\b(720p)\b/i.test(name)) {
      badges.push({ text: '720p', class: 'badge-720p' });
    }

    if (/\b(remux)\b/i.test(name)) {
      badges.push({ text: 'REMUX', class: 'badge-remux' });
    } else if (/\b(bluray|bdrip|brrip)\b/i.test(name)) {
      badges.push({ text: 'BluRay', class: 'badge-bluray' });
    } else if (/\b(web-?dl|webrip)\b/i.test(name)) {
      badges.push({ text: 'WEB-DL', class: 'badge-web' });
    }

    if (/\b(hdr10\+|hdr|dv|dolby[- .]?vision)\b/i.test(name)) {
      badges.push({ text: 'HDR', class: 'badge-hdr' });
    }

    if (/\b(hevc|x265|h\.?265)\b/i.test(name)) {
      badges.push({ text: 'HEVC', class: 'badge-hevc' });
    }

    return badges;
  }

  /* ==========================================================================
     2. DOM Metadata Extraction
     ========================================================================== */

  function extractMovieMetadata() {
    // 1. Film Title
    let title = '';
    const titleEl = document.querySelector('h1.headline-1, .film-title-wrapper h1, h1[itemprop="name"]');
    if (titleEl) {
      title = titleEl.textContent.trim();
    } else {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        title = (ogTitle.getAttribute('content') || '').replace(/\s*\(\d{4}\).*$/, '').trim();
      }
    }

    // Clean any parenthesis year in title e.g. "Heat (1995)"
    title = title.replace(/\s*\(\d{4}\)$/, '').trim();

    // 2. Release Year
    let year = '';
    const yearEl = document.querySelector('.releaseyear a, .production-masthead .releaseyear, [itemprop="dateCreated"]');
    if (yearEl) {
      year = yearEl.textContent.trim();
    } else {
      const yearMatch = window.location.pathname.match(/-(\d{4})\/?$/);
      if (yearMatch) year = yearMatch[1];
    }

    // 3. IMDb ID
    let imdbId = '';
    const imdbLink = document.querySelector('a[data-track-action="IMDb"], a[href*="imdb.com/title/tt"]');
    if (imdbLink) {
      const href = imdbLink.getAttribute('href') || '';
      const match = href.match(/(tt\d+)/);
      if (match) imdbId = match[1];
    }

    return { title, year, imdbId };
  }

  function buildSearchQuery(meta, template) {
    if (template === '{imdbId}' && meta.imdbId) {
      return meta.imdbId;
    }
    // Default: title and year
    if (meta.title && meta.year) {
      return `${meta.title} ${meta.year}`;
    }
    return meta.title || '';
  }

  /* ==========================================================================
     3. UI Construction (Strict XSS Prevention)
     ========================================================================== */

  function renderPanel(sidebar) {
    let existing = document.getElementById('qbit-letterboxd-panel');
    if (existing) existing.remove();

    const panel = document.createElement('section');
    panel.id = 'qbit-letterboxd-panel';
    panel.className = 'qbit-letterboxd-panel';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'qbit-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'qbit-header-left';

    const dots = document.createElement('div');
    dots.className = 'qbit-logo-dots';
    ['orange', 'green', 'blue'].forEach(color => {
      const d = document.createElement('span');
      d.className = `qbit-dot ${color}`;
      dots.appendChild(d);
    });

    const title = document.createElement('span');
    title.className = 'qbit-title';
    title.textContent = 'qBittorrent';

    headerLeft.appendChild(dots);
    headerLeft.appendChild(title);

    const headerActions = document.createElement('div');
    headerActions.className = 'qbit-header-actions';

    // Search Toggle Button
    const searchToggleBtn = document.createElement('button');
    searchToggleBtn.type = 'button';
    searchToggleBtn.className = 'qbit-icon-btn';
    searchToggleBtn.title = 'Editar termo de busca';
    searchToggleBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
    `;

    headerActions.appendChild(searchToggleBtn);
    header.appendChild(headerLeft);
    header.appendChild(headerActions);

    // 2. Collapsible Search Bar
    const searchBar = document.createElement('div');
    searchBar.className = 'qbit-search-bar hidden';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'qbit-search-input';
    searchInput.placeholder = 'Termo de busca...';

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'qbit-search-btn';
    searchBtn.textContent = 'Buscar';

    searchBar.appendChild(searchInput);
    searchBar.appendChild(searchBtn);

    searchToggleBtn.addEventListener('click', () => {
      searchBar.classList.toggle('hidden');
      if (!searchBar.classList.contains('hidden')) {
        searchInput.focus();
      }
    });

    searchBtn.addEventListener('click', () => {
      const q = searchInput.value.trim();
      if (q) performSearch(q);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        if (q) performSearch(q);
      }
    });

    // 3. Body Container
    const body = document.createElement('div');
    body.id = 'qbit-panel-body';
    body.className = 'qbit-body';

    panel.appendChild(header);
    panel.appendChild(searchBar);
    panel.appendChild(body);

    // Injection position: below #watch / #watch-panel or top of sidebar
    const watchPanel = sidebar.querySelector('#watch, #watch-panel, .services-panel, .track-this');
    if (watchPanel && watchPanel.parentNode === sidebar) {
      if (watchPanel.nextSibling) {
        sidebar.insertBefore(panel, watchPanel.nextSibling);
      } else {
        sidebar.appendChild(panel);
      }
    } else {
      sidebar.prepend(panel);
    }

    return { panel, body, searchInput, searchBar };
  }

  function setBodyStateUnconfigured(body) {
    body.replaceChildren();

    const container = document.createElement('div');
    container.className = 'qbit-unconfigured';

    const p = document.createElement('p');
    p.textContent = 'qBittorrent não conectado ou não configurado.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qbit-btn-primary';
    btn.textContent = 'Configurar Extensão';
    btn.addEventListener('click', () => {
      // Direct message or open options
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      } catch {
        // Fallback
      }
      alert('Por favor, abra as opções da extensão no menu do navegador para configurar o qBittorrent.');
    });

    container.appendChild(p);
    container.appendChild(btn);
    body.appendChild(container);
  }

  function setBodyStateLoading(body, query) {
    body.replaceChildren();

    const container = document.createElement('div');
    container.className = 'qbit-loading';

    const spinner = document.createElement('div');
    spinner.className = 'qbit-spinner';

    const text = document.createElement('div');
    text.className = 'qbit-loading-text';
    text.textContent = 'Buscando ';

    const qSpan = document.createElement('span');
    qSpan.className = 'qbit-loading-query';
    qSpan.textContent = `"${query}"`;
    text.appendChild(qSpan);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'qbit-retry-btn';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CANCEL_SEARCH' });
      setBodyStateEmpty(body, query, 'Busca cancelada.');
    });

    container.appendChild(spinner);
    container.appendChild(text);
    container.appendChild(cancelBtn);
    body.appendChild(container);
  }

  function setBodyStateResults(body, results) {
    body.replaceChildren();

    const list = document.createElement('div');
    list.className = 'qbit-results-list';

    results.forEach(item => {
      const row = document.createElement('div');
      row.className = 'qbit-result-item';

      const info = document.createElement('div');
      info.className = 'qbit-item-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'qbit-item-title-row';

      // Badges
      const badges = extractBadges(item.fileName);
      badges.forEach(b => {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = `qbit-badge ${b.class}`;
        badgeSpan.textContent = b.text;
        titleRow.appendChild(badgeSpan);
      });

      // Release Name
      const nameSpan = document.createElement('span');
      nameSpan.className = 'qbit-item-name';
      nameSpan.textContent = item.fileName;
      nameSpan.title = item.fileName;
      titleRow.appendChild(nameSpan);

      // Metadata line: Size + Seeders + Leechers
      const metaRow = document.createElement('div');
      metaRow.className = 'qbit-item-meta';

      const sizeSpan = document.createElement('span');
      sizeSpan.textContent = formatBytes(item.fileSize);

      const seedersSpan = document.createElement('span');
      seedersSpan.className = 'qbit-seeders';
      seedersSpan.textContent = `▲ ${item.nbSeeders}`;

      const leechersSpan = document.createElement('span');
      leechersSpan.className = 'qbit-leechers';
      leechersSpan.textContent = `▼ ${item.nbLeechers}`;

      metaRow.appendChild(sizeSpan);
      metaRow.appendChild(seedersSpan);
      metaRow.appendChild(leechersSpan);

      info.appendChild(titleRow);
      info.appendChild(metaRow);

      // Download Button
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'qbit-btn-download';
      downloadBtn.title = 'Adicionar torrent ao qBittorrent';
      downloadBtn.textContent = 'Baixar';

      downloadBtn.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        downloadBtn.className = 'qbit-btn-download downloading';
        downloadBtn.textContent = '...';

        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'ADD_TORRENT',
            payload: { fileUrl: item.fileUrl },
          });

          if (resp && resp.ok && resp.data && resp.data.success) {
            downloadBtn.className = 'qbit-btn-download added';
            downloadBtn.textContent = '✓ Adicionado';
          } else {
            const err = resp && resp.error ? resp.error : 'Erro desconhecido.';
            alert(`Falha ao adicionar download: ${err}`);
            downloadBtn.disabled = false;
            downloadBtn.className = 'qbit-btn-download';
            downloadBtn.textContent = 'Baixar';
          }
        } catch (e) {
          alert(`Erro de comunicação: ${e.message}`);
          downloadBtn.disabled = false;
          downloadBtn.className = 'qbit-btn-download';
          downloadBtn.textContent = 'Baixar';
        }
      });

      row.appendChild(info);
      row.appendChild(downloadBtn);
      list.appendChild(row);
    });

    body.appendChild(list);
  }

  function setBodyStateEmpty(body, query, customMsg) {
    body.replaceChildren();

    const container = document.createElement('div');
    container.className = 'qbit-empty';

    const p = document.createElement('p');
    p.textContent = customMsg || `Nenhum torrent encontrado para "${query}".`;

    const sub = document.createElement('p');
    sub.style.fontSize = '11px';
    sub.textContent = 'Dica: clique no ícone da lupa acima para editar o termo de busca (ex: sem o ano ou com o título original).';

    container.appendChild(p);
    container.appendChild(sub);
    body.appendChild(container);
  }

  function setBodyStateError(body, errorMsg, query) {
    body.replaceChildren();

    const container = document.createElement('div');
    container.className = 'qbit-error';

    const p = document.createElement('p');
    p.textContent = `Erro: ${errorMsg}`;

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'qbit-retry-btn';
    retryBtn.textContent = 'Tentar novamente';
    retryBtn.addEventListener('click', () => performSearch(query));

    container.appendChild(p);
    container.appendChild(retryBtn);
    body.appendChild(container);
  }

  /* ==========================================================================
     4. Main Execution Flow
     ========================================================================== */

  async function performSearch(query) {
    currentSearchQuery = query;
    const body = document.getElementById('qbit-panel-body');
    const searchInput = document.querySelector('.qbit-search-input');
    if (searchInput) searchInput.value = query;

    if (!body) return;
    setBodyStateLoading(body, query);

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'SEARCH_MOVIE',
        payload: { query },
      });

      if (!resp || !resp.ok) {
        const errorMsg = resp && resp.error ? resp.error : 'Erro desconhecido na busca.';
        setBodyStateError(body, errorMsg, query);
        return;
      }

      const results = resp.data && resp.data.results ? resp.data.results : [];
      if (results.length === 0) {
        setBodyStateEmpty(body, query);
      } else {
        setBodyStateResults(body, results);
      }
    } catch (err) {
      setBodyStateError(body, err.message || String(err), query);
    }
  }

  async function init() {
    const sidebar = document.querySelector('aside.sidebar');
    if (!sidebar) {
      console.log('[qBit] Sidebar não encontrada na página atual.');
      return;
    }

    const { body, searchInput } = renderPanel(sidebar);

    // Check configuration status first
    let statusResp;
    try {
      statusResp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG_STATUS' });
    } catch (e) {
      console.warn('[qBit] Background worker inacessível:', e);
      setBodyStateError(body, 'Background service worker indisponível.', '');
      return;
    }

    if (!statusResp || !statusResp.ok || !statusResp.data || !statusResp.data.isConfigured) {
      setBodyStateUnconfigured(body);
      return;
    }

    // Extract metadata & trigger search
    const meta = extractMovieMetadata();
    const query = buildSearchQuery(meta, statusResp.data.queryTemplate);
    if (!query) {
      setBodyStateEmpty(body, '', 'Não foi possível extrair o título do filme.');
      return;
    }

    if (searchInput) searchInput.value = query;
    performSearch(query);
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    try {
      chrome.runtime.sendMessage({ type: 'CANCEL_SEARCH' });
    } catch {
      // Ignored during page unload
    }
  });

  // Observe SPA navigation changes
  const observer = new MutationObserver(() => {
    if (window.location.pathname !== currentFilmUrl) {
      currentFilmUrl = window.location.pathname;
      if (currentFilmUrl.startsWith('/film/')) {
        setTimeout(init, 300);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
