# lghs-local

**lghs-local** — *Leonhart's Game Hosting System Local*

Brief de produto e operações para um host dedicado em hardware próprio (PC sobressalente), controlado via Discord. Documento independente: decisões desta discovery apenas.

| Campo | Valor |
| --- | --- |
| Status | Decisões aceitas para o MVP |
| UX | Português |
| Código | Inglês |
| Linguagem | TypeScript |
| Host (MVP) | Windows 10/11 (dev e spare PC iguais) |
| Host (depois) | Ubuntu Server, mesmo código |

---

## 1. Problema

Um grupo de amigos no Discord se reúne para jogar. Em vários títulos alguém precisa hospedar o servidor no PC pessoal e manter a máquina ligada para os outros jogarem. Existe um PC ocioso que pode virar esse host.

O objetivo é tornar o ciclo de vida do servidor de jogo o mais automatizado possível, porém configurável: subir, parar, ver status, fazer backup e enviar comandos pelo Discord, com o mínimo de atrito para conectar pela internet.

---

## 2. Contexto de uso

| Tópico | Acordo |
| --- | --- |
| Pessoas no dia a dia | 2–4 |
| Pico eventual | ~12 (ex.: fim de ano) |
| Interface | Somente Discord (slash commands) |
| Canal | Canal de bots já existente — comandos e anúncios no mesmo lugar |
| Host | PC sobressalente, pode ficar 24/7; a máquina de desenvolvimento usa o mesmo SO |
| Desligues longos | Ok (meses sem uso); religar deve exigir o mínimo de trabalho |
| Bot | Node nativo no mesmo PC do jogo |
| Admin do host | Operação local; OpenSSH Server opcional (WSL só como cliente SSH) |
| SO do MVP | Windows 10/11 |
| SO futuro | Ubuntu Server (mesmo código; paths, Docker e serviço via config + docs) |
| Runtime dos jogos | Docker — **containers Linux** (não Windows containers) |
| Docker no Windows | Docker Desktop (backend WSL2), uso pessoal |
| Painel web | Fora de escopo |

O jogo sempre roda em imagem Linux (`eclipse-temurin`, `run.sh`, etc.), mesmo com o host em Windows. Isso é o que deixa o Ubuntu posterior barato: o adapter não muda, só o jeito de instalar o bot e o daemon Docker.

Não hardcodar Ubuntu (nem paths POSIX) no core. Paths, socket/named pipe do Docker, instalação como serviço e o jeito de copiar pastas ficam em config + documentação.

### 2.1 Cold start no Windows (MVP)

Docker Desktop em geral sobe **após o login**. No PC ocioso 24/7 o desenho assume:

1. Auto-logon da conta do host
2. “Start Docker Desktop when you sign in”
3. Bot sobe como serviço/tarefa agendada
4. Revive lê o estado persistido e sobe a instância se estava “running”

Sem auto-logon + Docker no login, o revive no boot falha. No Ubuntu futuro isso vira systemd + Docker Engine, sem sessão de usuário.

Firewall do Windows precisa liberar a porta do jogo (além do forward no roteador).

### 2.2 Sync da pasta (operador, não Discord)

Continua procedimento manual — não há upload pelo Discord.

| Host | Ferramentas |
| --- | --- |
| Windows (MVP) | `robocopy` / WinSCP / pasta de rede |
| Ubuntu (depois) | `rsync` / SFTP / SCP |

---

## 3. Permissões

| Ação | Quem |
| --- | --- |
| `/start`, `/status`, `/list` | Qualquer membro |
| `/stop`, `/backup`, `/cmd` | Role de admin (nome definido na instalação) |

Roles do Discord bastam. Não há cooldown artificial de `/start`: o sistema deve detectar que o start já está em andamento ou que algo já está rodando e **não** enviar outro sinal de inicialização.

**Mutex:** um processo de bot só. Lock em memória + recusa de `/start` se o estado for `starting` ou `running`.

---

## 4. Rede e conexão

| Tópico | Acordo |
| --- | --- |
| Acesso | Público na internet (sem VPN obrigatória) |
| Mecanismo | Porta aberta no roteador + domínio + firewall do Windows |
| IP | Residencial dinâmico → DDNS |
| Provedor DNS/DDNS | Cloudflare (domínio + API atualizando o registro) |
| Porta Minecraft | 25565 global; override opcional no `manifest` |
| Endereço anunciado | Hostname (ex.: `mc.exemplo.com:25565`), não IP cru |
| Whitelist do jogo | Desligada por padrão (servidor aberto a quem tiver o endereço) |
| Ops in-game | Na mão no pack, se precisar; uso raro |
| EULA Minecraft | O sistema pode gravar `eula=true` no prepare/start |
| RCON | Só em `127.0.0.1` no host — **nunca** publicado na internet |

Uma instância por vez ⇒ um bind de porta de jogo só.

Domínio ainda será comprado no setup; o desenho já assume hostname estável.

**Cloudflare:** um lugar só para domínio e atualização de IP. Adequado ao caso residencial com IP que muda.

---

## 5. Jogos e instâncias

| Tópico | Acordo |
| --- | --- |
| MVP | Minecraft com **modpacks** (Forge / Fabric / NeoForge) |
| Extensão | Arquitetura deve permitir outros jogos depois |
| Próximo candidato | Palworld |
| Concorrência | Uma instância ativa por vez |
| Já existe algo rodando | `/start` é recusado com mensagem clara |
| Já está iniciando | Não dispara novo start |
| Identidade | `id` técnico (nome da pasta) + nome de exibição no Discord |
| Descoberta | Scan de pastas `instances/*/manifest.yml` |

### 5.1 Scan (sem comando register no MVP)

A pasta no disco é a fonte da verdade após o sync. Bastam pastas válidas com `manifest.yml`.

Um eventual comando de “register” só faria sentido depois (validar manifest pelo Discord, disable sem apagar pasta, etc.). Fora do MVP.

---

## 6. Preparação de modpack

Fluxo real do grupo: baixar zip (CurseForge/Modrinth) → extrair → bootstrap inicial → ajustar configs/mods na mão. Automatizar 100% isso no bot é frágil e varia por pack.

O bot **não** baixa modpack. A pasta preparada é a fonte da verdade. Não usar `itzg/minecraft-server` no MVP — essa imagem tenta instalar o pack.

**Modelo do MVP**

1. Preparar e validar o server pack no PC pessoal
2. Enviar a pasta da instância ao host (ver §2.2 — não upload pelo Discord)
3. O bot apenas **opera** o que já está no disco

**Layout no disco**

```text
instances/<instance-id>/
  manifest.yml
  server/
  overrides/
  world/
  backups/
```

**Layout no container**

- cwd = `server/`
- `world/` da instância montado em `server/world` (já deixa o update-in-place futuro possível)
- `overrides/` existe no layout mas **sem merge automático no MVP**
- `startCommand` obrigatório no manifest (ex.: `./run.sh nogui`) — scripts Linux, porque o container é Linux mesmo no host Windows

| Capacidade | Quando |
| --- | --- |
| Sync/replace da pasta | MVP |
| Bot só opera ciclo de vida | MVP |
| Import por URL / zip já no host | Depois |
| Update in-place preservando `world/` + `overrides/` | Depois (já previsto no layout; backup obrigatório antes) |

As duas estratégias de update ficam no desenho: **replace** e **update-in-place**. O MVP prioriza replace via sync.

---

## 7. Runtime, Java e console

| Tópico | Acordo |
| --- | --- |
| Isolamento | Docker, bind mount da pasta da instância |
| Imagem | JRE Linux por versão de Java no manifest (ex. Eclipse Temurin 17/21) |
| Java | O lghs-local escolhe a imagem JRE; não instala Java no SO do host |
| RAM JVM | No `manifest` (`memory`) |
| Start | `startCommand` no manifest; pack já preparado |
| Pronto para anunciar | Server List Ping (protocolo Minecraft), não só “container up” |
| Timeout de ready | Configurável no manifest; default **15 min** (ATM10 e afins demoram) |
| Comandos ao vivo | RCON em `127.0.0.1`; no Discord como `/cmd` (admin) |
| Senha RCON | `.env` (ou gerada na primeira preparação e gravada em `server.properties`) |
| Parada | Sempre limpa: RCON `stop` → espera → encerra o container |
| Logs | Só arquivos no host (MVP) |
| Auto-stop por idle | Não |
| Estado para revive | `runtime/state.json` no host (instância pretendida) |
| Após crash/reboot | Se o estado diz `running`, sobe de novo |
| Cold start | Ver §2.1 (Windows) / systemd + Docker Engine (Ubuntu depois) |

### 7.1 Por que Docker

- Start/stop/restart previsível e alinhado a revive no boot
- Java por instância sem poluir o SO
- Isolamento quando entrarem outros jogos
- Portas e (se útil) limites de recurso por container
- Bind mount: sync e edição de arquivos continuam como pasta normal no host
- Runtime do jogo idêntico no Windows e no Ubuntu (sempre container Linux)

Trade-off: setup inicial um pouco maior que rodar o script do pack direto no SO. Mitigado por RCON + logs no volume + acesso local ou SSH opcional.

---

## 8. Backups

| Tópico | Acordo |
| --- | --- |
| Gatilhos | Agendado + manual (`/backup`) |
| Intervalo | Configurável no `manifest` |
| Conteúdo | Snapshot de `world/` + whitelist/ops/`server.properties` se existirem em `server/` |
| Servidor up | RCON `save-all` / `save-off` … depois `save-on` |
| Formato | `tar.gz` via lib Node (igual no Windows e no Linux) |
| Retenção rolling | ~7 backups |
| Âncoras | Diária (início do dia) + semanal (início da semana) |
| Fuso | `America/Sao_Paulo` |
| Disco cheio | Sem regra especial no MVP |

---

## 9. Configuração e secrets

Config global no host: `lghs.yml`. Secrets em `.env` só no host — **nunca no git**.

### 9.1 `lghs.yml`

```yaml
discord:
  guildId: "123"
  channelId: "456"
  adminRoleId: "789"          # ou nome definido na instalação
network:
  hostname: mc.exemplo.com
  gamePort: 25565
  cloudflare:
    zone: exemplo.com
    record: mc
paths:
  instances: "C:\\lghs\\instances"   # no Ubuntu: /var/lib/lghs/instances
  runtime: "C:\\lghs\\runtime"
timezone: America/Sao_Paulo
```

Token Cloudflare e o resto secreto ficam no `.env`, não aqui.

### 9.2 `instances/<id>/manifest.yml`

O `id` técnico é o nome da pasta. Campos mínimos:

```yaml
displayName: ATM10
game: minecraft                 # adapter
java: 21                        # escolhe a imagem JRE (Temurin 17/21)
memory: 8G
startCommand: "./run.sh nogui"  # obrigatório
port: 25565                     # opcional; default = network.gamePort
readyTimeout: 15m               # opcional; default 15 min
backup:
  interval: 6h
  retain: 7
```

### 9.3 `.env`

```text
DISCORD_TOKEN=
CLOUDFLARE_API_TOKEN=
RCON_PASSWORD=
```

---

## 10. Comandos Discord (MVP)

| Comando | Quem | Intenção |
| --- | --- | --- |
| `/start [instância]` | todos | Sobe a instância |
| `/stop` | admin | Parada limpa |
| `/status` | todos | Estado, jogo, endereço |
| `/list` | todos | Instâncias encontradas no scan |
| `/backup` | admin | Snapshot manual |
| `/cmd <…>` | admin | Comando via RCON |

### Anúncio (tom)

Texto final pode ser ajustado; a ideia é:

> **ATM10** está online
> Conecte: `mc.exemplo.com:25565`
> Pedido por @fulano

Anunciar também quando o servidor cair/parar, no mesmo canal. Anunciar só depois do Server List Ping suceder (não no “container up”).

---

## 11. Arquitetura lógica

```text
Discord (slash commands)
        │
        ▼
┌───────────────────┐
│  Control plane    │  TypeScript / Node no host (Windows ou Ubuntu)
│  permissões       │
│  mutex            │
│  anúncios         │
│  backups agendados│
└─────────┬─────────┘
          │
          ├─► inventário de instâncias (scan em disco + runtime/state.json)
          ├─► DNS (Cloudflare DDNS)
          ├─► runtime (Docker API: named pipe no Windows, socket no Linux)
          └─► adapter de jogo (Minecraft modpack + RCON)
                      │
                      ▼
              container Linux + bind mount
              instances/<id>/server + world → server/world
```

Um jogo ativo por vez. Extensão a novos títulos = novo adapter + manifest, sem reescrever o bot.

### 11.1 Stack

| Peça | Escolha |
| --- | --- |
| Runtime do bot | Node.js LTS 22 |
| Linguagem | TypeScript |
| Discord | discord.js |
| Docker | API via `dockerode` (named pipe no Windows, socket no Linux) |
| CLI / serviço | Node — **sem bash como dependência de runtime** |
| Backups | `tar.gz` via lib Node |

Serviço do bot: tarefa/serviço no Windows (MVP); unit systemd no Ubuntu depois. Documentado na instalação, não no core.
