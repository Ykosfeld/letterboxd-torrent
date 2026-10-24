# Letterboxd + qBittorrent Search (Manifest V3)

Extensão de navegador moderna que integra diretamente as páginas de filmes do **Letterboxd** (`https://letterboxd.com/film/*`) à Web API v2 do **qBittorrent**.

Ao acessar qualquer filme no Letterboxd, a extensão consulta os indexadores configurados no seu qBittorrent, lista os melhores torrents ordenados por *seeders* diretamente na barra lateral e permite iniciar o download com apenas 1 clique.

---

## Principais Recursos & Segurança

- **Zero Hardcoded Secrets & Context Isolation:** O script injetado no Letterboxd (`content.js`) **nunca** tem acesso a senhas, tokens ou à URL do servidor. Toda a comunicação ocorre no Service Worker isolado (`background.js`).
- **Bypass Limpo de CORS e CSRF:** Não é necessário desativar proteções de CSRF ou validação de Host Header no qBittorrent. A extensão utiliza `chrome.declarativeNetRequest` com regras dinâmicas para reescrever os cabeçalhos `Origin` e `Referer` de requisições originadas pela extensão.
- **Gerenciamento de Senha Flexível:**
  - *Modo Sessão Segura (Recomendado):* A senha fica apenas na memória da sessão (`chrome.storage.session`) e nunca é gravada em disco.
  - *Modo Criptografado Local:* A senha é cifrada via Web Crypto API (`SubtleCrypto` com `AES-GCM` de 256 bits) e gravada em `chrome.storage.local`.
- **Permissões Mínimas Dinâmicas:** Acesso ao host do qBittorrent é solicitado sob demanda via `chrome.permissions.request` durante a configuração.
- **Prevenção Estrita contra XSS:** Construção 100% segura do DOM sem interpolação de `innerHTML` com dados vindos de trackers.
- **Visual Letterboxd Dark Nativo:** Interface integrada à paleta oficial do Letterboxd com badges de qualidade (`4K`, `1080p`, `REMUX`, `WEB-DL`, `HDR`, etc.) e seeders em verde `#00e054`.
- **Busca Manual Recolhível:** Permite alterar o termo de busca diretamente na barra lateral com 1 clique (ex: para títulos originais ou edições especiais).
- **Sem Bundlers ou Dependências Externas:** Escrito em Vanilla JS puro (ES2022+), CSS3 e HTML5.

---

## Estrutura do Projeto

```text
├── manifest.json              # Configuração Manifest V3
├── background.js              # Service Worker (Auth, API qBittorrent, DNR, Polling)
├── content.js                 # Extração de metadados e renderização segura na sidebar
├── content.css                # Estilo escuro nativo do Letterboxd
├── options.html               # Interface de configurações
├── options.js                 # Lógica de conexão, validação e salvamento
├── icons/                     # Ícones da extensão (16x16, 48x48, 128x128)
├── scripts/                   # Scripts auxiliares (geração de ícones)
├── tests/                     # Testes unitários automatizados (Node.js)
└── package.json
```

---

## Como Instalar no Navegador

### Google Chrome / Brave / Edge / Opera

1. Abra o gerenciador de extensões do navegador:
   - Chrome: `chrome://extensions/`
   - Brave: `brave://extensions/`
   - Edge: `edge://extensions/`
2. No canto superior direito, ative a chave **"Modo do desenvolvedor"** (*Developer mode*).
3. Clique no botão **"Carregar sem compactação"** (*Load unpacked*).
4. Selecione esta pasta raiz (`/home/ykosfeld/Projetos/letterboxd-torrent`).
5. A extensão estará instalada!

### Mozilla Firefox

1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em **"Carregar extensão temporária..."** (*Load Temporary Add-on...*).
3. Selecione o arquivo `manifest.json` desta pasta.

---

## Como Configurar

1. Clique com o botão direito no ícone da extensão na barra do navegador e selecione **Opções** (ou acesse a tela de opções pelo gerenciador de extensões).
2. Preencha os campos:
   - **URL Base do qBittorrent:** ex: `http://localhost:8080` ou o IP da sua máquina/Tailscale.
   - **Nome de Usuário:** ex: `admin`.
   - **Senha:** sua senha do Web UI.
   - **Armazenamento da Senha:** escolha entre *Modo Sessão Segura* ou *Modo Criptografado Local*.
   - **Máximo de Resultados:** padrão `5` (1 a 25).
   - **Plugins de Busca:** `enabled` ou `all`.
   - **Categoria ao Adicionar:** opcional, ex: `filmes` ou `letterboxd`.
3. Clique em **"Testar Conexão & Salvar"**.
4. Autorize a permissão para o endereço do seu qBittorrent no pop-up do navegador.
5. Receba a confirmação com a versão do qBittorrent (ex: `qBittorrent v4.6.3`).

---

## Execução de Testes Automatizados

Para executar a suíte de testes unitários:

```bash
npm test
# ou diretamente via node:
node --test tests/*.test.js
```
