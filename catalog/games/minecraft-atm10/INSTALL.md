# All the Mods 10 (servidor)

O lghs-local **não baixa** o pack. Baixe o *Server pack* no CurseForge/Modrinth.

## Pasta

```text
data/instances/minecraft-atm10/
  manifest.yml      ← já gravado pelo catálogo
  INSTALL.md
  server/           ← extraia o server pack AQUI (startserver.sh, mods, installer)
  world/
  backups/
```

O nome da pasta extraída (ex. `ATM10-server/`) não deve ficar como subpasta: o conteúdo vai para `server/`.

## Start

- Java 21 (o container traz Temurin 21)
- RAM: 8G no manifest; aumente se o pack pedir
- Script Linux: `startserver.sh` (não use `startserver.bat`)
- Na primeira subida o script instala o NeoForge (`libraries/`). Pode demorar.
- ATM10 costuma levar vários minutos até o Server List Ping; o anúncio no Discord só sai depois disso.

## Depois de copiar o pack

No console local: **Start**. Ou no Discord: `/start instancia:minecraft-atm10`.
