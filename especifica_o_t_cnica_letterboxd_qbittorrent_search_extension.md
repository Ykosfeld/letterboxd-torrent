# Especificação Técnica (Spec): Extensão Letterboxd + qBittorrent Search

## 1. Visão Geral do Projeto
Desenvolver uma extensão de navegador (Manifest V3, compatível com Chromium/Chrome/Brave e Firefox) que integra páginas de filmes do **Letterboxd** (`https://letterboxd.com/film/*`) diretamente à API Web v2 de uma instância do **qBittorrent**. 

Ao carregar a página de um filme, a extensão deve extrair metadados do filme (Título, Ano, IMDb ID), acionar os plugins de busca configurados no qBittorrent do usuário, listar os $N$ melhores resultados (ordenados por *seeders*) diretamente na barra lateral do Letterboxd e permitir iniciar o download no qBittorrent com 1 clique.

---

## 2. Requisitos de Segurança e Parametrização (Crítico)

A extensão **NÃO DEVE** conter URLs, portas, usuários ou senhas fixos no código (*hardcoded*), nem exigir que o usuário desative camadas de segurança do qBittorrent (como CSRF ou Host Header Validation).

### 2.1. Armazenamento Seguro de Credenciais
* Utilizar exclusivamente a API `chrome.storage.local` para persistir configurações de conexão (Host/URL, Porta, Nome de Usuário, limite $N$ de resultados, Categoria padrão).
* **Gerenciamento de Senha e Sessão:**
  * A extensão deve oferecer duas opções na página de configurações (*Options Page*):
    1. **Modo Sessão Segura (Recomendado):** A senha não é salva em disco, ou é mantida apenas em `chrome.storage.session` (em memória, apagada ao fechar o navegador). O Service Worker autentica no endpoint `/api/v2/auth/login` e reutiliza o cookie de sessão `SID` gerenciado pelo navegador enquanto estiver válido.
    2. **Modo Criptografado Local:** Caso o usuário opte por salvar a senha permanentemente em `chrome.storage.local`, ela deve ser cifrada utilizando a **Web Crypto API** (`SubtleCrypto` com `AES-GCM`) antes de ser armazenada.
* **Isolamento de Contexto:** O *Content Script* (`content.js`), que roda no contexto da página do Letterboxd, **JAMAIS** deve ter acesso às credenciais, URL do servidor ou tokens de sessão. Toda comunicação com o qBittorrent deve ocorrer estritamente dentro do *Background Service Worker* (`background.js`), comunicando-se com o *Content Script* via mensagens internas (`chrome.runtime.sendMessage`) contendo apenas dados sanitizados dos torrents.

### 2.2. Contorno Limpo de CORS e CSRF (`declarativeNetRequest`)
* O qBittorrent possui proteção contra *Cross-Site Request Forgery* (CSRF) e validação de cabeçalhos `Host`/`Origin`/`Referer`.
* Em vez de pedir ao usuário para desativar essas proteções no qBittorrent, o Service Worker deve registrar uma regra dinâmica usando a API `chrome.declarativeNetRequest.updateDynamicRules` sempre que a URL do servidor for configurada nas Opções.
* Essa regra deve interceptar chamadas originadas pela própria extensão para o `qbitUrl` configurado e reescrever os cabeçalhos HTTP `Origin` e `Referer` para corresponderem exatamente ao `qbitUrl` (ex: `http://localhost:8080`).

### 2.3. Permissões Dinâmicas (`optional_host_permissions`)
* Para que o usuário possa configurar qualquer IP/Host (ex: `http://127.0.0.1:8080`, `http://192.168.1.50:8080` ou um IP do Tailscale como `http://100.x.y.z:8080`), o `manifest.json` deve declarar `optional_host_permissions: ["http://*/*", "https://*/*"]`.
* No momento em que o usuário salvar a URL do servidor na página de Opções, a extensão deve solicitar permissão explícita apenas para aquela origem usando `chrome.permissions.request({ origins: [userConfiguredOrigin] })`.

---

## 3. Arquitetura e Estrutura de Arquivos

A LLM deve implementar os seguintes arquivos:

```text
letterboxd-qbit-search/
├── manifest.json        # Configuração Manifest V3
├── background.js        # Service Worker (Auth, API qBittorrent, declarativeNetRequest)
├── content.js           # Extração do DOM no Letterboxd e injeção da UI
├── content.css          # Estilos isolados (tema escuro nativo do Letterboxd)
├── options.html         # Interface de configuração segura do usuário
└── options.js           # Lógica de salvamento, teste de conexão e solicitação de permissão
```

---

## 4. Especificação dos Módulos (Etapas de Implementação)

### Etapa 1: `manifest.json`
Configurar sob **Manifest V3** com:
* `permissions`: `["storage", "declarativeNetRequest", "declarativeNetRequestWithHostAccess"]`
* `host_permissions`: `["https://letterboxd.com/film/*"]`
* `optional_host_permissions`: `["http://*/*", "https://*/*"]`
* `background`: `{ "service_worker": "background.js" }`
* `content_scripts`: Injetando `content.js` e `content.css` em `https://letterboxd.com/film/*`.
* `options_ui`: Apontando para `options.html` (`open_in_tab: true`).

---

### Etapa 2: Página de Configurações (`options.html` & `options.js`)
Criar uma página limpa e responsiva permitindo configurar os seguintes parâmetros:
1. **URL Base do qBittorrent** (ex: `http://localhost:8080` — validar formato de URL e remover barra final `/`).
2. **Usuário** (ex: `admin`).
3. **Senha** (campo `type="password"`).
4. **Número máximo de resultados ($N$)** (padrão: `5`, min: `1`, max: `25`).
5. **Plugins de busca** (padrão: `enabled` ou `all`).
6. **Categoria de busca** (padrão: `all` ou `movies`).
7. **Categoria/Tag no qBittorrent ao adicionar download** (opcional, ex: `filmes` ou `letterboxd`).
8. **Formato da Query de Busca**: Seletor entre `{title} {year}` (padrão) ou `{imdbId}` (para quem usa indexadores que buscam por ID do IMDb).
9. **Botão "Testar Conexão & Salvar"**:
   * Solicita a permissão de host via `chrome.permissions.request`.
   * Configura a regra de `declarativeNetRequest` para ajustar `Origin` e `Referer` para a URL informada.
   * Realiza uma chamada de teste ao endpoint `/api/v2/auth/login` e `/api/v2/app/version` via `background.js` e exibe feedback visual ("Conectado ao qBittorrent vX.Y.Z!" ou mensagem de erro detalhada).

---

### Etapa 3: Background Service Worker (`background.js`)
Responsável por toda a comunicação com a Web API v2 do qBittorrent.

#### 3.1. Autenticação (`ensureAuthenticated()`)
* Faz `POST {baseUrl}/api/v2/auth/login` com `Content-Type: application/x-www-form-urlencoded` e body `username=...&password=...` usando `credentials: "include"`.
* Se retornar `Ok.`, o cookie `SID` estará salvo na sessão do navegador.
* Caso qualquer requisição subsequente à API retorne status HTTP `403 Forbidden`, o Service Worker deve chamar `ensureAuthenticated()` automaticamente uma vez e tentar repetir a requisição (retry).

#### 3.2. Fluxo de Busca Assíncrona (`handleSearchMovie(payload)`)
Como a busca no qBittorrent é assíncrona, implementar o seguinte ciclo:
1. **Iniciar job de busca:**
   * `POST {baseUrl}/api/v2/search/start`
   * Body (`application/x-www-form-urlencoded`): `pattern={query}&plugins={plugins}&category={category}`
   * Resposta esperada: `{ "id": <search_id> }`
2. **Polling de status e resultados parciais:**
   * A cada `1200ms` (com timeout máximo de `15000ms`), consultar `GET {baseUrl}/api/v2/search/status?id=<search_id>`.
   * Resposta esperada: `[{ "id": <search_id>, "status": "Running" | "Stopped", "total": <int> }]`.
   * Quando `status === "Stopped"` (ou se atingir o timeout mas `total > 0`), avançar para o passo 3.
3. **Coletar e filtrar resultados:**
   * `GET {baseUrl}/api/v2/search/results?id=<search_id>`
   * Ordenar o array `results` de forma decrescente por `nbSeeders`.
   * Selecionar os primeiros $N$ itens (conforme configurado pelo usuário).
   * Mapear apenas os campos seguros para enviar ao Content Script:
     * `fileName` (string, sanitizado)
     * `fileSize` (number, em bytes)
     * `nbSeeders` (number)
     * `nbLeechers` (number)
     * `fileUrl` (string - magnet link ou URL `.torrent`)
     * `descrLink` (string - link da página do tracker, opcional)
4. **Limpar job de busca (Cleanup obrigatório em bloco `finally`):**
   * `POST {baseUrl}/api/v2/search/delete` com body `id=<search_id>` para não vazar memória na instância do qBittorrent.

#### 3.3. Adicionar Torrent (`handleAddTorrent(payload)`)
* Recebe `fileUrl` do Content Script.
* Envia `POST {baseUrl}/api/v2/torrents/add` (`application/x-www-form-urlencoded` ou `multipart/form-data`).
* Parâmetros: `urls={fileUrl}` e, se configurado nas opções, `category={userCategory}` e `tags=letterboxd`.
* Retorna sucesso (`true`) ou erro (`false`) ao Content Script.

---

### Etapa 4: Extração de Dados e UI no Letterboxd (`content.js` & `content.css`)

#### 4.1. Extração de Metadados do DOM
Ao carregar `https://letterboxd.com/film/*`, extrair de forma resiliente:
* **Título em Inglês/Exibição:** `document.querySelector('h1.headline-1, .film-title-wrapper h1')?.textContent?.trim()`
* **Ano de Lançamento:** `document.querySelector('.releaseyear a, .production-masthead .releaseyear')?.textContent?.trim()`
* **IMDb ID (Fallback/Opcional):** Extrair via Regex `/tt\d+/` do atributo `href` de `document.querySelector('a[data-track-action="IMDb"]')`.

#### 4.2. Injeção da Interface na Sidebar
* Localizar a barra lateral direita da página do filme: `aside.sidebar` (preferencialmente logo abaixo do painel `#watch` / JustWatch).
* Criar um container `<section class="qbit-letterboxd-panel">` estilizado com a paleta nativa do Letterboxd:
  * Fundo: `#14181c` / Bordas e separadores: `#2c3440`
  * Texto primário: `#9ab` / Destaque: `#fff`
  * Verde Letterboxd (Seeders / Sucesso): `#00e054`
  * Laranja Letterboxd (Loading / Alerta): `#ff8000`
  * Azul Letterboxd (Hover / Links): `#40bcf4`
* **Estados do Componente:**
  1. **Não configurado:** Exibe um botão discreto "Configurar qBittorrent" que abre a página de opções.
  2. **Carregando (Searching...):** Exibe um *spinner* discreto indicando a query buscada (ex: *"Buscando 'Heat 1995' no qBittorrent..."*) e um botão para refazer/editar a busca manualmente caso o título tenha caracteres especiais.
  3. **Lista de Resultados ($N$ itens):**
     * Cada linha exibe:
       * Nome do release truncado com `title` completo no hover (destacando badges como `1080p`, `2160p`/`4K`, `REMUX`, `WEB-DL` extraídos via regex do `fileName`).
       * Tamanho formatado em `GB` ou `MB` (ex: `4.2 GB`).
       * Quantidade de Seeders (`▲ 142` em `#00e054`) e Leechers (`▼ 12`).
       * Botão de ação rápida **Baixar** (ícone de download).
  4. **Feedback de Download:**
     * Ao clicar em "Baixar", o botão muda para estado de loading (`...`) e, após confirmação do Service Worker, muda para `✓ Adicionado` (em verde `#00e054`) e fica desabilitado para evitar cliques duplicados.

---

## 5. Critérios de Aceite e Boas Práticas para a LLM

1. **Prevenção de XSS:** Jamais utilizar `innerHTML` para renderizar `fileName` retornado pelos indexadores de torrent. Utilizar exclusivamente `document.createElement` e `textContent`.
2. **Cancelamento de Busca ao Sair da Página:** Caso o usuário feche a aba ou navegue para outro filme antes de o polling terminar, enviar um sinal ou garantir que o job de busca no qBittorrent seja encerrado (`/api/v2/search/stop` e `/api/v2/search/delete`).
3. **Zero Dependências Externas:** Todo o código deve ser escrito em Vanilla JavaScript (ES2022+), HTML5 e CSS3 puro, pronto para ser carregado diretamente no navegador via *"Carregar sem compactação" (Load unpacked)* sem necessidade de bundlers complexos.
4. **Busca Manual Editável:** Incluir um pequeno campo de texto recolhível no cabeçalho do widget na página do Letterboxd, permitindo que o usuário edite o termo de busca (por exemplo, trocar o título traduzido pelo título original do filme) e dispare uma nova busca com 1 clique.