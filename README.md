# lghs-local

**lghs-local** — *Leonhart's Game Hosting System Local*

Host de jogos no PC de casa, controlado só pelo Discord: subir, parar, ver status, backup e comandos no servidor. O MVP é Minecraft com modpack (Forge / Fabric / NeoForge). Uma instância por vez.

O bot Node roda **nativo no Windows**. O jogo roda em **container Linux** (Docker Desktop). O mesmo código serve depois num Ubuntu.

Decisões de produto: [docs/README.md](docs/README.md).

---

## Índice

1. [Requisitos](#requisitos)
2. [Roteiro de configuração inicial](#roteiro-de-configuração-inicial)
3. [Comandos Discord](#comandos-discord)
4. [Layout de uma instância](#layout-de-uma-instância)
5. [Referência de config](#referência-de-config)
6. [Rede (amigos pela internet)](#rede-amigos-pela-internet)
7. [PC 24/7 (spare)](#pc-247-spare)
8. [Desenvolvimento](#desenvolvimento)
9. [Problemas comuns](#problemas-comuns)

---

## Requisitos

| Peça | Detalhe |
| --- | --- |
| SO | Windows 10/11 (máquina de dev e spare PC iguais) |
| Node.js | **22** ou mais novo (`node -v`) |
| Docker | Docker Desktop, backend **WSL2**, containers **Linux** |
| Discord | Servidor onde você pode convidar bots e criar/usar uma role de admin |
| RAM | O pack dita. ATM10 costuma querer 8 GB+ **só para o Java**, além do Windows e do Docker |
| Domínio | Opcional no primeiro teste local; necessário para o endereço estável (`mc.seudominio.com`) |

Não instale Java no Windows para o servidor: o container traz o JRE (Temurin 8 / 17 / 21, conforme o `manifest`).

---

## Roteiro de configuração inicial

Faça nesta ordem. Os passos 1–7 deixam o bot respondendo no Discord. Os passos 8–9 são para os amigos conectarem pela internet e para o PC ocioso ficar 24/7.

### 1. Instalar Node e Docker

1. Instale o [Node.js LTS 22+](https://nodejs.org/) (instalador Windows, ou nvm-windows).
2. Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/).
3. Na instalação, aceite o backend **WSL2**.
4. Abra o Docker Desktop uma vez e espere ficar **Engine running**.
5. Settings → General → marque **Start Docker Desktop when you sign in**.
6. Settings → Resources: dê RAM de verdade (se o pack pede 8G, o Docker precisa de mais que isso).
7. **Se você vai rodar o bot no WSL** (Cursor / Ubuntu): Settings → **Resources → WSL Integration** → ligue a distro (ex. Ubuntu) → Apply & Restart. Sem isso existe o comando `docker`, mas **não** o daemon (`/var/run/docker.sock` não aparece).

No PowerShell **e** no WSL:

```powershell
node -v          # v22 ou v24
docker version   # Client e Server
```

Se só aparecer Client (`connect: no such file or directory` / `ENOENT /var/run/docker.sock`), o Desktop não está no ar **ou** a integração WSL da distro está desligada.

**WSL vs Windows:** `npm run dev` no Ubuntu funciona com a integração ligada. Paths em `lghs.yml` devem ser os do ambiente em que o Node roda. Produção no spare PC: Node nativo no Windows.

### 2. Criar o bot no Discord

1. Abra [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → nome (ex.: `lghs-local`).
2. Menu **Bot**:
   - **Reset Token** e copie o valor. Isso é o `DISCORD_TOKEN`. Guarde só no `.env`.
   - *Public Bot* pode ficar desligado (só o seu servidor).
   - Intents privilegiados (**Message Content**, **Server Members**) **não** são necessários.
3. Menu **OAuth2 → URL Generator**:
   - Scopes: `bot` e `applications.commands`
   - Bot Permissions: **View Channels**, **Send Messages**, **Read Message History**
4. Abra a URL gerada, escolha o servidor e autorize.

O bot precisa aparecer **online** na lista de membros depois que o processo Node subir (passo 6). Ainda não rode nada.

### 3. Pegar os IDs do servidor

No Discord: **User Settings → Advanced → Developer Mode** (ligado).

| Campo no `lghs.yml` | Como copiar |
| --- | --- |
| `discord.guildId` | Clique direito no **servidor** → Copy Server ID |
| `discord.channelId` | Clique direito no **canal do bot** (comandos e anúncios no mesmo lugar) → Copy Channel ID |
| `discord.adminRoleId` | Clique direito na **role de admin** → Copy Role ID |

`adminRoleId` também aceita o **nome** da role, mas ID é mais estável (renomear a role não quebra).

Quem tem essa role pode `/stop`, `/backup` e `/cmd`. Qualquer membro do canal pode `/start`, `/status` e `/list`.

### 4. Configurar o repositório

Na pasta do projeto (PowerShell ou WSL):

```bash
cp lghs.example.yml lghs.yml
cp .env.example .env
npm install
```

Edite o `.env`:

```text
DISCORD_TOKEN=cole_o_token_do_passo_2
CLOUDFLARE_API_TOKEN=
RCON_PASSWORD=uma_senha_longa_aleatoria
```

- `RCON_PASSWORD` é obrigatório. O bot grava isso no `server.properties` a cada start. **Não** abra a porta 25575 no roteador — RCON fica em `127.0.0.1`.
- `CLOUDFLARE_API_TOKEN` pode ficar vazio no teste local. Sem token, o DDNS é ignorado (aviso no log).

Edite o `lghs.yml`:

```yaml
discord:
  guildId: "cole_o_server_id"
  channelId: "cole_o_channel_id"
  adminRoleId: "cole_o_role_id"
network:
  hostname: mc.exemplo.com          # pode ficar assim até ter domínio
  gamePort: 25565
  cloudflare:
    zone: exemplo.com               # domínio raiz na Cloudflare
    record: mc                      # vira mc.exemplo.com
paths:
  instances: ./data/instances       # ok para desenvolver neste repo
  runtime: ./data/runtime
timezone: America/Sao_Paulo
```

No spare PC, depois, use paths absolutos do Windows, por exemplo `C:\lghs\instances` e `C:\lghs\runtime`.

`lghs.yml` e `.env` **não vão para o git** (já estão no `.gitignore`).

### 5. Preparar a primeira instância (modpack)

O bot **não** baixa pack. Você monta a pasta, o bot só opera.

1. Baixe o **Server pack** (CurseForge / Modrinth), não o zip de cliente.
2. Extraia e faça o bootstrap que o pack pede (installer Forge/NeoForge, se houver) até existir um jeito Linux de subir — em geral `run.sh`.
3. Crie a pasta da instância. O **nome da pasta** é o `id` técnico (sem espaços; letras, números, `_`, `.`, `-`):

```text
data/instances/atm10/
  manifest.yml
  server/          ← conteúdo do server pack (jars, mods, run.sh, …)
  world/           ← vazio na primeira vez; o mundo mora aqui, não só em server/world
  backups/         ← o bot cria se faltar
  overrides/       ← reserva para update futuro; o MVP não mescla sozinho
```

4. Copie o exemplo e ajuste:

```bash
cp examples/instances/atm10/manifest.yml data/instances/atm10/manifest.yml
```

```yaml
displayName: ATM10
game: minecraft
java: 21                      # 8, 17 ou 21 — tem que bater com o pack
memory: 8G                    # teto da JVM; o container ganha ~25% a mais de cota
startCommand: "./run.sh nogui"
readyTimeout: 15m             # ATM10 e afins demoram; o anúncio espera o ping, não o container
backup:
  interval: 6h
  retain: 7
```

**`startCommand` roda dentro do Linux.** `run.bat` não serve. Se o pack só gerou scripts Windows, rode o installer uma vez no WSL (`java -jar *installer.jar --installServer`) para sair o `run.sh`.

**Mundo:** o container monta `world/` **por cima** de `server/world`. Se você já testou o pack e o mundo ficou em `server/world`, **mova** essa pasta para `data/instances/<id>/world/` antes do `/start`. Senão o bot sobe um mundo novo e o antigo fica escondido.

### 6. Subir o bot

Docker Desktop **running**. Na raiz do repo:

```bash
npm run dev
```

Log esperado, mais ou menos:

```text
[lghs] config .../lghs.yml
[lghs] instances .../data/instances
[discord] online como SeuBot#1234
```

- Se faltar `lghs.yml` ou `DISCORD_TOKEN` / `RCON_PASSWORD`, o processo morre com mensagem clara.
- Se o Docker ainda estiver abrindo, o bot espera até ~3 min e então falha.

Deixe esse terminal aberto. Ctrl+C só desconecta o Discord; **não** para o Minecraft se ele já estiver no Docker.

Slash commands são registrados no servidor na hora do login. Na primeira vez podem levar alguns segundos para o Discord mostrar `/start`.

### 7. Testar no canal

No **mesmo canal** do `channelId`:

| Ordem | Comando | O que esperar |
| --- | --- | --- |
| 1 | `/list` | `ATM10` (`atm10`) — minecraft |
| 2 | `/status` | Nenhuma instância online |
| 3 | `/start` → instância `atm10` | “Subindo **ATM10**. Aviso neste canal quando estiver online.” |

O anúncio **ATM10 está online / Conecte: `hostname:porta`** só sai depois do Server List Ping. Pack pesado = vários minutos, até o `readyTimeout`.

Conecte no cliente Minecraft em `localhost:25565` (nesta máquina) para validar. Só então parta para a rede.

`/stop` (admin) faz parada limpa (RCON `stop` → espera → remove o container). Os arquivos em `server/` e `world/` permanecem.

### 8. Rede (quando for jogar pela internet)

Localhost não precisa disso. Para os amigos:

1. **Firewall do Windows:** regra de entrada TCP na porta do jogo (`25565`, ou a do manifest).
2. **Roteador:** redirecionar essa porta TCP para o IP LAN do PC host. IP do host deve ser reservado no DHCP.
3. **CGNAT:** se o IP WAN começar com `100.64.x.x` ou o roteador não mostrar IPv4 público, o provedor está em CGNAT e port forward **não** funciona. Aí só 4G/CGNAT-bypass (Tailscale, IPv6, outro link) — fora do desenho atual.
4. **Domínio + Cloudflare** (passo 9 do roteiro de DNS abaixo).

RCON (`25575`) **não** entra no roteador.

### 9. Cloudflare DDNS (opcional, mas é o desenho)

1. Domínio na Cloudflare.
2. Registro **A** `mc` apontando para o IP público de agora. Nuvem **cinza** (DNS only). Proxy laranja quebra Minecraft (TCP 25565 não é HTTP).
3. [API Token](https://dash.cloudflare.com/profile/api-tokens) com o template **Edit zone DNS**, só nessa zona.
4. Cole em `CLOUDFLARE_API_TOKEN`. Em `lghs.yml`: `zone` = domínio raiz, `record` = `mc`, `hostname` = `mc.seudominio.com`.
5. Reinicie o bot. A cada 5 min ele atualiza o A se o IP mudou.

---

## Comandos Discord

Só funcionam no canal configurado.

| Comando | Quem | Efeito |
| --- | --- | --- |
| `/start instancia:` | todos | Sobe a instância. Recusa se já tem start ou algo online |
| `/stop` | admin | Parada limpa |
| `/status` | todos | Estado, nome, endereço |
| `/list` | todos | Scan do disco |
| `/backup` `instancia:` (opcional) | admin | Snapshot `tar.gz` em `backups/` |
| `/cmd comando:` | admin | Comando via RCON (ex.: `list`) |

Anúncios de online/offline/falha vão para o mesmo canal. Online só depois do ping, não no “container up”.

---

## Layout de uma instância

```text
instances/<id>/
  manifest.yml
  server/          # pack (replace no sync)
  world/           # persistente; montado em /data/server/world
  backups/         # tar.gz rolling + âncoras daily/weekly
  overrides/       # ainda sem merge automático
```

Sync da pasta (você, não o Discord): no Windows, `robocopy` / WinSCP / pasta de rede. No Ubuntu futuro, `rsync`.

---

## Referência de config

### `lghs.yml`

| Chave | Significado |
| --- | --- |
| `discord.guildId` | Servidor |
| `discord.channelId` | Canal de comandos e anúncios |
| `discord.adminRoleId` | ID (ou nome) da role de `/stop` `/backup` `/cmd` |
| `network.hostname` | O que o anúncio mostra (não o IP cru) |
| `network.gamePort` | Porta padrão; o manifest pode sobrescrever |
| `network.cloudflare.zone` / `record` | DDNS |
| `paths.instances` | Onde estão as pastas das instâncias |
| `paths.runtime` | `state.json` e `bot.pid` |
| `timezone` | Backups âncora (`America/Sao_Paulo`) |

Path relativo é resolvido **a partir da pasta do `lghs.yml`**. Outro arquivo: variável `LGHS_CONFIG`.

### `.env`

| Chave | Obrigatório |
| --- | --- |
| `DISCORD_TOKEN` | sim |
| `RCON_PASSWORD` | sim |
| `CLOUDFLARE_API_TOKEN` | não (DDNS desliga) |

### `manifest.yml`

| Chave | Obrigatório | Notas |
| --- | --- | --- |
| `displayName` | sim | Nome no Discord |
| `game` | não | default `minecraft` |
| `java` | sim | `8`, `17` ou `21` → imagem Temurin |
| `memory` | sim | ex. `8G`, `512M` |
| `startCommand` | sim | ex. `./run.sh nogui` |
| `port` | não | default = `network.gamePort` |
| `readyTimeout` | não | default `15m` |
| `backup.interval` | não | default `6h` |
| `backup.retain` | não | default `7` rolling (âncoras daily/weekly à parte) |

---

## Rede (amigos pela internet)

Resumo do que o anúncio usa: `network.hostname` + porta da instância.

O bot atualiza o registro A na Cloudflare; **não** abre porta no roteador. Isso é manual, uma vez (e se o IP LAN do host mudar).

Minecraft precisa de:

1. Porta TCP no host (Docker publica `0.0.0.0:25565`)
2. Firewall do Windows
3. Port forward no roteador
4. DNS **não** proxied

---

## PC 24/7 (spare)

No Windows o Docker Desktop sobe **depois do login**. Sem sessão, o revive no boot não funciona.

Checklist no spare PC:

1. Windows 10/11 + Docker Desktop (WSL2) + Node 22, **mesmo** setup desta máquina
2. Copiar o repo (ou `git pull`), `npm install`, `npm run build`
3. Copiar `lghs.yml`, `.env` e a pasta `instances/`
4. Conta do Windows com **auto-logon** (ex. `netplwiz` ou Autologon da Sysinternals)
5. Docker Desktop: *Start when you sign in*
6. Agendador de Tarefas: ao logon, iniciar o bot na pasta do projeto, por exemplo `node dist/index.js` (depois de `npm run build`)
7. Energia: desligar sleep/hibernação; BIOS “restore on power loss” se quiser voltar de queda de luz

O estado fica em `paths.runtime/state.json`. Se estava `running`, o bot sobe a instância de novo quando ele próprio volta.

Ainda não há instalador de serviço Windows no repo; a tarefa agendada cobre o MVP.

---

## Desenvolvimento

```bash
npm install
npm run dev          # tsx, recarrega na mão (Ctrl+C e sobe de novo)
npm run typecheck
npm run build        # dist/
npm start            # node dist/index.js  (precisa do build)
```

Código em inglês, mensagens do Discord em português. Stack: Node 22, TypeScript, discord.js, dockerode.

Um segundo processo do bot é recusado (`runtime/bot.pid`).

SIGINT/SIGTERM: o bot sai; o container de jogo **continua**.

---

## Problemas comuns

| Sintoma | O que checar |
| --- | --- |
| `lghs.yml não encontrado` | Rodar `npm run dev` na **raiz** do repo, ou definir `LGHS_CONFIG` |
| Discord: bot offline | Token, `npm run dev` ainda rodando, bot convidado no servidor certo |
| Comandos não aparecem | Scopes `applications.commands`; esperar 1 min; canal/servidor IDs certos |
| “só funcionam no canal configurado” | Você não está no `channelId` |
| Sem permissão em `/stop` | A role do `adminRoleId` tem que estar **nessa conta**, neste servidor |
| `/list` vazio | Pasta `paths.instances/<id>/manifest.yml`; `id` sem espaços |
| Console do bot sem log do Minecraft | Esperado no código antigo; agora o start imprime `[host]` / `[docker]` / `[mc]`. Reinicie `npm run dev` |
| `ENOENT /var/run/docker.sock` ou `docker version` só Client | Docker Desktop aberto no Windows; **Settings → Resources → WSL Integration** ligada para esta distro; `docker version` tem que mostrar Server |
| Start aceito, nunca anuncia | Pack ainda carregando; `readyTimeout`; linhas `[mc]` no terminal; `startCommand` tem que existir em `server/` (não numa subpasta tipo `ATM10-server/`) |
| `Permission denied` em `./startserver.sh` | Zip/Windows sem bit `+x`. O bot dá `chmod` nos `.sh` e chama o script via `bash`, sem depender de executável |
| Mundo “zerado” | Mundo antigo ficou em `server/world` e foi tapado pelo mount de `world/` |
| Amigos não entram | Firewall, port forward, CGNAT, Cloudflare **proxied** (tem que ser DNS only) |
| Dois bots | Já existe `bot.pid`; mate o outro processo |

Logs do Minecraft: `instances/<id>/server/logs/` no host (bind mount). No Discord, no MVP, não sobem logs.

---

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [docs/README.md](docs/README.md) | Brief de produto (decisões do MVP) |
| [lghs.example.yml](lghs.example.yml) | Config global de exemplo |
| [.env.example](.env.example) | Secrets |
| [examples/instances/atm10/manifest.yml](examples/instances/atm10/manifest.yml) | Manifest mínimo |
