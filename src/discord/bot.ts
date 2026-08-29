import {
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { log, logError } from "../log.js";
import type { Host } from "../runtime/host.js";
import type { LghsConfig, Secrets } from "../types.js";

const ADMIN = new Set(["stop", "backup", "cmd"]);

function commands() {
  return [
    new SlashCommandBuilder()
      .setName("start")
      .setDescription("Sobe uma instância de jogo")
      .addStringOption((o) =>
        o.setName("instancia").setDescription("Instância para subir").setRequired(true).setAutocomplete(true),
      ),
    new SlashCommandBuilder().setName("stop").setDescription("Parada limpa da instância online"),
    new SlashCommandBuilder().setName("status").setDescription("Estado, jogo e endereço"),
    new SlashCommandBuilder().setName("list").setDescription("Instâncias encontradas no disco"),
    new SlashCommandBuilder()
      .setName("backup")
      .setDescription("Snapshot manual do mundo")
      .addStringOption((o) =>
        o
          .setName("instancia")
          .setDescription("Instância (padrão: a que está online)")
          .setRequired(false)
          .setAutocomplete(true),
      ),
    new SlashCommandBuilder()
      .setName("cmd")
      .setDescription("Envia um comando via RCON")
      .addStringOption((o) =>
        o.setName("comando").setDescription("Comando do servidor").setRequired(true),
      ),
  ].map((c) => c.toJSON());
}

function isAdmin(interaction: ChatInputCommandInteraction, adminRoleId: string): boolean {
  const guild = interaction.guild;
  if (!guild) return false;
  const role =
    guild.roles.cache.get(adminRoleId) ?? guild.roles.cache.find((r) => r.name === adminRoleId);
  if (!role) return false;
  const member = interaction.member;
  if (!member) return false;
  if (member instanceof GuildMember) {
    return member.roles.cache.has(role.id);
  }
  const roles = (member as { roles: string[] }).roles;
  return Array.isArray(roles) && roles.includes(role.id);
}

async function announce(client: Client, config: LghsConfig, text: string): Promise<void> {
  const channel = await client.channels.fetch(config.discord.channelId);
  if (channel && channel.isTextBased() && "send" in channel) {
    await channel.send(text);
  }
}

function actorOf(interaction: ChatInputCommandInteraction) {
  return { id: interaction.user.id, label: interaction.user.displayName };
}

async function autocompleteInstances(interaction: AutocompleteInteraction, host: Host): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const instances = await host.list();
  const choices = instances
    .filter(
      (i) =>
        i.id.toLowerCase().includes(focused) ||
        i.manifest.displayName.toLowerCase().includes(focused),
    )
    .slice(0, 25)
    .map((i) => ({ name: `${i.manifest.displayName} (${i.id})`, value: i.id }));
  await interaction.respond(choices);
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  config: LghsConfig,
  host: Host,
): Promise<void> {
  if (interaction.guildId !== config.discord.guildId) {
    await interaction.reply({ content: "Este bot não está configurado neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.channelId !== config.discord.channelId) {
    await interaction.reply({
      content: "Os comandos só funcionam no canal configurado.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (ADMIN.has(interaction.commandName) && !isAdmin(interaction, config.discord.adminRoleId)) {
    await interaction.reply({
      content: "Você precisa da role de admin para isso.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (interaction.commandName) {
    case "start": {
      const id = interaction.options.getString("instancia", true);
      const result = await host.requestStart(id, actorOf(interaction));
      await interaction.reply(result.message);
      return;
    }
    case "stop": {
      const result = await host.requestStop(actorOf(interaction));
      await interaction.reply(result.message);
      return;
    }
    case "status": {
      await interaction.reply(await host.describeStatus());
      return;
    }
    case "list": {
      const instances = await host.list();
      if (instances.length === 0) {
        await interaction.reply("Nenhuma instância no disco. Confira o path em `lghs.yml`.");
        return;
      }
      const lines = instances.map(
        (i) => `• **${i.manifest.displayName}** (\`${i.id}\`) — ${i.manifest.game}`,
      );
      await interaction.reply(lines.join("\n"));
      return;
    }
    case "backup": {
      const id = interaction.options.getString("instancia") ?? undefined;
      await interaction.deferReply();
      const result = await host.requestBackup(id);
      await interaction.editReply(result.message);
      return;
    }
    case "cmd": {
      const command = interaction.options.getString("comando", true);
      await interaction.deferReply();
      const result = await host.requestCmd(command);
      await interaction.editReply(result.message);
      return;
    }
    default:
      await interaction.reply({ content: "Comando desconhecido.", flags: MessageFlags.Ephemeral });
  }
}

export async function startBot(config: LghsConfig, secrets: Secrets, host: Host): Promise<Client> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (ready) => {
    const rest = new REST({ version: "10" }).setToken(secrets.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(ready.application.id, config.discord.guildId), {
      body: commands(),
    });
    log("discord", `online como ${ready.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await autocompleteInstances(interaction, host);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      await handleCommand(interaction, config, host);
    } catch (err) {
      logError("discord", `interação: ${err instanceof Error ? err.message : String(err)}`);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Erro interno ao processar o comando.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => undefined);
      }
    }
  });

  host.on("online", ({ instance, actor, address }) => {
    const who = actor.id ? `<@${actor.id}>` : actor.label;
    void announce(
      client,
      config,
      `**${instance.manifest.displayName}** está online\nConecte: \`${address}\`\nPedido por ${who}`,
    );
  });

  host.on("offline", ({ instance }) => {
    void announce(client, config, `**${instance.manifest.displayName}** ficou offline.`);
  });

  host.on("startFailed", ({ instance, error }) => {
    void announce(client, config, `Não deu para subir **${instance.manifest.displayName}**: ${error}`);
  });

  await client.login(secrets.DISCORD_TOKEN);
  return client;
}
