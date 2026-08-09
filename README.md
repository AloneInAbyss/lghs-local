# lghs-local

**lghs-local** — *Leonhart's Game Hosting System Local*

Brief de produto e operações para um host dedicado em hardware próprio (PC sobressalente), controlado via Discord. Documento independente: decisões desta discovery apenas.

| Campo | Valor |
| --- | --- |
| Status | Decisões aceitas para o MVP |
| UX | Português |
| Código | Inglês |
| Linguagem | TypeScript |

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
| Host | PC sobressalente, pode ficar 24/7 |
| Desligues longos | Ok (meses sem uso); religar deve exigir o mínimo de trabalho |
| Bot | Roda no mesmo PC do jogo |
| Admin do host | SSH com chave; operador usa WSL no dia a dia |
| SO recomendado | Ubuntu Server |
| Runtime dos jogos | Docker (containers) |
| Painel web | Fora de escopo |

---

## 3. Permissões

| Ação | Quem |
| --- | --- |
| `/start`, `/status`, `/list` | Qualquer membro |
| `/stop`, `/backup`, `/cmd` | Role de admin (nome definido na instalação) |

Roles do Discord bastam. Não há cooldown artificial de `/start`: o sistema deve detectar que o start já está em andamento ou que algo já está rodando e **não** enviar outro sinal de inicialização.

---

## 4. Rede e conexão

| Tópico | Acordo |
| --- | --- |
| Acesso | Público na internet (sem VPN obrigatória) |
| Mecanismo | Porta aberta no roteador + domínio |
| IP | Residencial dinâmico → DDNS |
| Provedor DNS/DDNS | Cloudflare (domínio + API atualizando o registro) |
| Porta Minecraft | 25565 (padrão) |
| Endereço anunciado | Hostname (ex.: `mc.exemplo.com:25565`), não IP cru |
| Whitelist do jogo | Desligada por padrão (servidor aberto a quem tiver o endereço) |
| Ops in-game | Na mão no pack, se precisar; uso raro |
| EULA Minecraft | O sistema pode gravar `eula=true` no prepare/start |

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

**Modelo do MVP**

1. Preparar e validar o server pack no PC pessoal  
2. Enviar a pasta da instância ao host (rsync / SFTP / SCP — não upload pelo Discord)  
3. O bot apenas **opera** o que já está no disco  

**Layout conceitual**

```text
instances/<instance-id>/
  manifest.yml
  server/
  overrides/
  world/
  backups/
```

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
| Isolamento | Docker, com bind mount da pasta da instância |
| Java | O lghs-local instala e gerencia a versão por instância |
| RAM JVM | No `manifest` |
| Comandos ao vivo | RCON; no Discord como `/cmd` (admin) |
| Parada | Sempre limpa: RCON `stop` → espera → encerra o container |
| Logs | Só arquivos no host (MVP) |
| Auto-stop por idle | Não |
| Após crash/reboot | Ressuscitar automaticamente o que estava rodando |
| Cold start | Ligar o PC → serviços sobem sozinhos → bot online |

### 7.1 Por que Docker

- Start/stop/restart previsível e alinhado a revive no boot  
- Java por instância sem poluir o SO  
- Isolamento quando entrarem outros jogos  
- Portas e (se útil) limites de recurso por container  
- Bind mount: sync e edição de arquivos continuam como pasta normal no host  

Trade-off: setup inicial um pouco maior que rodar o script do pack direto no SO. Mitigado por RCON + logs no volume + SSH.

---

## 8. Backups

| Tópico | Acordo |
| --- | --- |
| Gatilhos | Agendado + manual (`/backup`) |
| Intervalo | Configurável no `manifest` |
| Retenção rolling | ~7 backups |
| Âncoras | Manter também âncoras mais lentas (ex.: início do dia + início da semana) |
| Fuso | `America/Sao_Paulo` |
| Disco cheio | Sem regra especial no MVP |

---

## 9. Configuração e secrets

| Tópico | Acordo |
| --- | --- |
| Config global | `lghs.yml` no host (domínio, canal, roles, DDNS, paths…) |
| Secrets | `.env` (ou equivalente) só no host — nunca no git |

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

Anunciar também quando o servidor cair/parar, no mesmo canal.

---

## 11. Arquitetura lógica

```text
Discord (slash commands)
        │
        ▼
┌───────────────────┐
│  Control plane    │  TypeScript, sempre ligado (mesmo PC)
│  permissões       │
│  mutex            │
│  anúncios         │
│  backups agendados│
└─────────┬─────────┘
          │
          ├─► inventário de instâncias (scan em disco + estado)
          ├─► DNS (Cloudflare DDNS)
          ├─► runtime (Docker)
          └─► adapter de jogo (Minecraft modpack + RCON)
                      │
                      ▼
              container + bind mount
              instances/<id>/…
```

Um jogo ativo por vez. Extensão a novos títulos = novo adapter + manifest, sem reescrever o bot.

---

## 12. Definição de pronto (MVP)

- Um modpack no host via sync  
- Comandos da seção 10 funcionando  
- Anúncio com domínio no canal de bots  
- Backup manual + agendado com a retenção acordada  
- Revive após reboot  
- Cold start: ligar o PC → stack no ar  

---

## 13. Fora de escopo do MVP

- Painel web  
- VPN obrigatória  
- Vários jogos/instâncias ao mesmo tempo  
- Install completo de modpack só pelo Discord  
- Auto-stop por ausência de players  
- Alerta/bloqueio por disco cheio  
- Comando de register de instância  

---

## 14. Próximos passos sugeridos

1. Comprar/configurar domínio na Cloudflare e DDNS  
2. Preparar Ubuntu Server + Docker + SSH no spare PC  
3. Fechar o shape de `lghs.yml` e `manifest.yml`  
4. Implementar control plane + adapter Minecraft + runtime Docker  
5. Validar com um modpack real (WSL → sync → `/start`)  

---

## 15. Registro

| Data | Nota |
| --- | --- |
| 2026-08-09 | Discovery (perguntas/respostas); brief gravado como documento autônomo |
