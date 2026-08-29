const $ = (id) => document.getElementById(id);
const wizard = $("wizard");
const dash = $("dash");
const logview = $("logview");
const actionMsg = $("action-msg");

let es;
let follow = true;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || res.statusText);
  return data;
}

function fillSelect(el, items, label) {
  el.innerHTML = items
    .map((i) => `<option value="${i.id}">${label(i)}</option>`)
    .join("");
}

function connectLogs() {
  es?.close();
  logview.textContent = "";
  const stream = $("stream").value;
  es = new EventSource(`/api/logs?stream=${encodeURIComponent(stream)}`);
  es.onmessage = (ev) => {
    const line = JSON.parse(ev.data);
    const time = new Date(line.ts).toLocaleTimeString("pt-BR", { hour12: false });
    const row = document.createElement("div");
    row.className = `s-${line.stream}`;
    row.textContent = `${time} [${line.stream}] ${line.text}`;
    logview.appendChild(row);
    if (follow) logview.scrollTop = logview.scrollHeight;
  };
}

async function refresh() {
  const st = await api("/api/status");
  $("top-status").textContent = st.configured
    ? `${st.discord.online ? "Discord " + (st.discord.tag || "online") : "Discord offline"} · ${st.host?.status ?? "—"}`
    : "não configurado";
  if (!st.configured) {
    wizard.classList.remove("hidden");
    dash.classList.add("hidden");
    return;
  }
  wizard.classList.add("hidden");
  dash.classList.remove("hidden");
  const h = st.host || {};
  $("state").innerHTML = `
    <dt>Status</dt><dd>${h.status ?? "—"}</dd>
    <dt>Instância</dt><dd>${h.instanceId ?? "nenhuma"}</dd>
    <dt>Endereço</dt><dd>${st.address ?? "—"}</dd>
    <dt>Pedido por</dt><dd>${h.requestedBy ?? "—"}</dd>
    <dt>Host</dt><dd>${st.hostError ? st.hostError : "ok"}</dd>
  `;
  $("instances").innerHTML = (st.instances || [])
    .map(
      (i) => `<div class="inst">
        <span><strong>${i.displayName}</strong><br /><span class="muted">${i.id} · ${i.game} · Java ${i.java} · ${i.memory}</span></span>
        <button data-start="${i.id}">Start</button>
      </div>`,
    )
    .join("") || `<p class="muted">Nenhuma pasta com manifest.yml.</p>`;
  $("instances").querySelectorAll("[data-start]").forEach((btn) => {
    btn.onclick = async () => {
      const r = await api("/api/start", { method: "POST", body: JSON.stringify({ instanceId: btn.dataset.start }) });
      actionMsg.textContent = r.message;
    };
  });
}

async function loadCatalog() {
  const data = await api("/api/catalog");
  $("catalog").innerHTML = (data.games || [])
    .map(
      (g) => `<div class="inst">
        <span><strong>${g.displayName}</strong><br /><span class="muted">${g.summary || g.game}${g.installed ? " · já no disco" : ""}</span></span>
        <span>
          <button data-guide="${g.id}">Guia</button>
          <button data-install="${g.id}" ${g.installed ? "disabled" : ""}>Preparar pasta</button>
        </span>
      </div>`,
    )
    .join("");
  $("catalog").querySelectorAll("[data-guide]").forEach((btn) => {
    btn.onclick = async () => {
      const g = await api(`/api/catalog/${btn.dataset.guide}`);
      const el = $("guide");
      el.classList.remove("hidden");
      el.textContent = g.install;
    };
  });
  $("catalog").querySelectorAll("[data-install]").forEach((btn) => {
    btn.onclick = async () => {
      await api("/api/catalog/install", { method: "POST", body: JSON.stringify({ id: btn.dataset.install }) });
      actionMsg.textContent = `Pasta ${btn.dataset.install} criada. Copie o server pack para server/.`;
      await loadCatalog();
      await refresh();
    };
  });
}

$("btn-stop").onclick = async () => {
  const r = await api("/api/stop", { method: "POST", body: "{}" });
  actionMsg.textContent = r.message;
};
$("btn-backup").onclick = async () => {
  const r = await api("/api/backup", { method: "POST", body: "{}" });
  actionMsg.textContent = r.message;
};
$("btn-cmd").onclick = async () => {
  const r = await api("/api/cmd", { method: "POST", body: JSON.stringify({ command: $("cmd").value }) });
  actionMsg.textContent = r.message;
};
$("stream").onchange = connectLogs;
$("follow").onchange = (e) => {
  follow = e.target.checked;
};
$("btn-clear").onclick = () => {
  logview.textContent = "";
};

$("w-inspect").onclick = async () => {
  $("w-err").textContent = "";
  try {
    const info = await api("/api/setup/discord", {
      method: "POST",
      body: JSON.stringify({ token: $("w-token").value }),
    });
    $("w-bot").textContent = `Bot: ${info.tag}`;
    $("w-invite").innerHTML = info.guilds.length
      ? `${info.guilds.length} servidor(es) onde o bot já está.`
      : `Convide o bot: <a href="${info.inviteUrl}" target="_blank" rel="noreferrer">abrir convite</a> e valide o token de novo.`;
    fillSelect($("w-guild"), info.guilds, (g) => g.name);
  } catch (err) {
    $("w-err").textContent = err.message;
  }
};

$("w-guild-load").onclick = async () => {
  $("w-err").textContent = "";
  try {
    const data = await api("/api/setup/guild", {
      method: "POST",
      body: JSON.stringify({ token: $("w-token").value, guildId: $("w-guild").value }),
    });
    fillSelect($("w-channel"), data.channels, (c) => `#${c.name}`);
    fillSelect($("w-role"), data.roles, (r) => r.name);
  } catch (err) {
    $("w-err").textContent = err.message;
  }
};

$("w-rcon-gen").onclick = async () => {
  const s = await api("/api/setup/secret");
  $("w-rcon").value = s.secret;
};

$("w-save").onclick = async () => {
  $("w-err").textContent = "";
  try {
    await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        discordToken: $("w-token").value,
        guildId: $("w-guild").value,
        channelId: $("w-channel").value,
        adminRoleId: $("w-role").value,
        hostname: $("w-host").value,
        gamePort: Number($("w-port").value) || 25565,
        cloudflareZone: $("w-cf-zone").value || "exemplo.com",
        cloudflareRecord: $("w-cf-record").value || "mc",
        cloudflareToken: $("w-cf-token").value,
        rconPassword: $("w-rcon").value,
        instancesPath: "./data/instances",
        runtimePath: "./data/runtime",
      }),
    });
    await refresh();
    await loadCatalog();
    connectLogs();
  } catch (err) {
    $("w-err").textContent = err.message;
  }
};

connectLogs();
refresh().then(loadCatalog).catch((err) => {
  $("top-status").textContent = err.message;
});
setInterval(() => {
  refresh().catch(() => undefined);
}, 2500);
