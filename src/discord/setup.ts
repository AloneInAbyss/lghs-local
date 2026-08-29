const API = "https://discord.com/api/v10";

async function discord<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord ${res.status}: ${body.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

export async function inspectBotToken(token: string): Promise<{
  tag: string;
  clientId: string;
  inviteUrl: string;
  guilds: { id: string; name: string }[];
}> {
  const me = await discord<{ username: string; discriminator: string; id: string }>(token, "/users/@me");
  const app = await discord<{ id: string }>(token, "/oauth2/applications/@me");
  const guilds = await discord<{ id: string; name: string }[]>(token, "/users/@me/guilds");
  const permissions = "68608";
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${app.id}&permissions=${permissions}&scope=bot%20applications.commands`;
  const tag = me.discriminator && me.discriminator !== "0" ? `${me.username}#${me.discriminator}` : me.username;
  return {
    tag,
    clientId: app.id,
    inviteUrl,
    guilds: guilds.map((g) => ({ id: g.id, name: g.name })),
  };
}

export async function inspectGuild(
  token: string,
  guildId: string,
): Promise<{
  channels: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}> {
  const channels = await discord<{ id: string; name: string; type: number }[]>(
    token,
    `/guilds/${guildId}/channels`,
  );
  const roles = await discord<{ id: string; name: string }[]>(token, `/guilds/${guildId}/roles`);
  return {
    channels: channels
      .filter((c) => c.type === 0 || c.type === 5)
      .map((c) => ({ id: c.id, name: c.name })),
    roles: roles.filter((r) => r.id !== guildId).map((r) => ({ id: r.id, name: r.name })),
  };
}
