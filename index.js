// index.js – Position Preference Bot

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const {
  getUserPrefs: sharedGetUserPrefs,
  setUserPrefs: sharedSetUserPrefs
} = require('./sharedPositionPrefs');

// =======================
// BASIC SETUP
// =======================

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN env var not set');
  process.exit(1);
}

// We need:
// - Guilds (slash commands, channels)
// - GuildVoiceStates (for /posboard VC snapshot)
// - GuildMembers (for /posprefs role-based boards)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// Positions to track (order matters for ranking)
const POSITIONS = [
  'ST',
  'RW',
  'LW',
  'CAM',
  'RDM',
  'LDM',
  'LB',
  'LCB',
  'RCB',
  'RB',
  'GK'
];

const PREFS_LIMIT = POSITIONS.length;

// Some nice visuals for positions
const POSITION_META = Object.freeze({
  ST:  { emoji: '⚽', label: 'Striker' },
  RW:  { emoji: '🏃‍♂️', label: 'Right Wing' },
  LW:  { emoji: '🏃‍♂️', label: 'Left Wing' },
  CAM: { emoji: '🎯', label: 'Attacking Midfielder' },
  RDM: { emoji: '🛡️', label: 'Right Defensive Mid' },
  LDM: { emoji: '🛡️', label: 'Left Defensive Mid' },
  LB:  { emoji: '🧱', label: 'Left Back' },
  LCB: { emoji: '🧱', label: 'Left Centre Back' },
  RCB: { emoji: '🧱', label: 'Right Centre Back' },
  RB:  { emoji: '🧱', label: 'Right Back' },
  GK:  { emoji: '🧤', label: 'Goalkeeper' }
});

// Rank emojis for nicer lists
const RANK_EMOJI = Object.freeze({
  1: '1️⃣',
  2: '2️⃣',
  3: '3️⃣',
  4: '4️⃣',
  5: '5️⃣',
  6: '6️⃣',
  7: '7️⃣',
  8: '8️⃣',
  9: '9️⃣',
  10: '🔟',
  11: '1️⃣1️⃣'
});

// =======================
// HELPERS
// =======================

function isValidPosition(pos) {
  return POSITIONS.includes(pos);
}

// Always store prefs per-guild
function getUserPrefs(guildId, userId) {
  if (!guildId || !userId) return [];
  const data = sharedGetUserPrefs(guildId, userId);
  return Array.isArray(data) ? data : data || [];
}

function setUserPrefs(guildId, userId, prefs) {
  if (!guildId || !userId) return;
  if (!Array.isArray(prefs)) prefs = [];
  sharedSetUserPrefs(guildId, userId, prefs);
}

// Build a neat progress bar like: █████░░░░░
function buildProgressBar(current, max, length = 11) {
  const ratio = max === 0 ? 0 : current / max;
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// Build the "your prefs" embed (ephemeral per user)
function buildPrefsEmbed(selected) {
  const list = selected || [];
  const used = list.length;
  const bar = buildProgressBar(used, PREFS_LIMIT, 11);

  const header =
    `Slots used: **${used}/${PREFS_LIMIT}**\n` +
    `\`${bar}\`\n\n`;

  let body;

  if (list.length === 0) {
    body =
      'No positions selected yet.\n' +
      'Click the buttons below to add up to **11** positions in order of preference.\n' +
      'Click a selected position again to remove it.';
  } else {
    const lines = list.map((pos, i) => {
      const rank = i + 1;
      const rankIcon = RANK_EMOJI[rank] || `${rank}.`;
      const meta = POSITION_META[pos];
      const friendly = meta
        ? `${meta.emoji || ''} **${pos}** – ${meta.label}`
        : `**${pos}**`;
      return `${rankIcon} ${friendly}`;
    });

    body =
      'Your current preferences:\n' +
      lines.join('\n') +
      '\n\nYou can click more buttons to add (up to 11) or click a selected one to remove it.';
  }

  return new EmbedBuilder()
    .setTitle('🎮 Rank Your Positions')
    .setColor(0x5865f2)
    .setDescription(
      header +
        body +
        '\n\nAvailable positions:\n' +
        '`ST, RW, LW, CAM, RDM, LDM, LB, LCB, RCB, RB, GK`'
    )
    .setFooter({ text: 'Your preferences are saved automatically per server.' });
}

// Build position buttons + control row for the ephemeral panel
function buildPrefComponents(selected) {
  const list = selected || [];
  const rows = [];
  let currentRow = new ActionRowBuilder();

  POSITIONS.forEach((pos, index) => {
    const isSelected = list.includes(pos);
    const meta = POSITION_META[pos];
    const label = pos;
    const emoji = meta?.emoji;

    const button = new ButtonBuilder()
      .setCustomId(`prefpos_${pos}`)
      .setLabel(label)
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);

    if (emoji) {
      button.setEmoji(emoji);
    }

    currentRow.addComponents(button);

    if (currentRow.components.length === 5 || index === POSITIONS.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('prefs_done')
      .setLabel('Done')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('prefs_clear')
      .setLabel('Clear')
      .setStyle(ButtonStyle.Danger)
  );

  rows.push(controlRow);
  return rows;
}

// Format entries for position-based boards; names are clickable mentions
function formatPositionEntries(entries) {
  if (!entries || entries.length === 0) {
    return '*No data yet*';
  }

  const lines = entries.map((entry) => {
    const rank = entry.rank;
    const emoji = RANK_EMOJI[rank] || `${rank}.`;
    const mention = `<@${entry.userId}>`;
    return `${emoji} ${mention}`;
  });

  let text = lines.join('\n');

  const MAX = 950; // stay safely under field limit
  if (text.length <= MAX) return text;

  while (text.length > MAX && lines.length > 0) {
    lines.pop();
    text = lines.join('\n');
  }

  const hiddenCount = entries.length - lines.length;
  if (hiddenCount > 0) {
    text += `\n…and **${hiddenCount}** more`;
  }

  return text;
}

// Build a position prefs embed from a list of participants
// participants: [{ member, prefs }]
function buildPosPrefsEmbedForParticipants(guild, participants, label) {
  const posMap = {};
  POSITIONS.forEach((p) => (posMap[p] = []));

  for (const p of participants) {
    const userId = p.member.id;
    p.prefs.forEach((pos, index) => {
      if (!posMap[pos]) return;
      const rank = index + 1;
      posMap[pos].push({ userId, rank });
    });
  }

  const memberById = new Map(
    participants.map((p) => [p.member.id, p.member])
  );

  POSITIONS.forEach((pos) => {
    const entries = posMap[pos];
    if (!entries || entries.length === 0) return;
    entries.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const aMember = memberById.get(a.userId);
      const bMember = memberById.get(b.userId);
      const aName =
        aMember?.displayName || aMember?.user?.username || a.userId;
      const bName =
        bMember?.displayName || bMember?.user?.username || b.userId;
      return aName.localeCompare(bName);
    });
  });

  const fields = POSITIONS.map((pos) => {
    const meta = POSITION_META[pos];
    const nameEmoji = meta?.emoji || '▫️';
    const title = `${nameEmoji} ${pos}`;
    const value = formatPositionEntries(posMap[pos]);
    return { name: title, value, inline: true };
  });

  const isAll = !label || label === 'Entire Server';
  const desc = isAll
    ? `Players with saved preferences in this server: **${participants.length}**\n` +
      'Sorted by **player preference rank** (1️⃣ = top choice).'
    : `Filter: **${label}** • players with saved preferences: **${participants.length}**\n` +
      'Sorted by **player preference rank** (1️⃣ = top choice).';

  return new EmbedBuilder()
    .setTitle(`🧩 Position Preferences – ${label || 'Entire Server'}`)
    .setColor(0x5865f2)
    .setDescription(desc)
    .addFields(fields)
    .setFooter({
      text: 'Only players with saved preferences are shown.'
    });
}

// Build a StringSelectMenu of roles that have at least one user with prefs
function buildPosPrefsRoleSelect(guild, participants) {
  const roleStats = new Map(); // roleId -> { role, count }

  for (const { member } of participants) {
    member.roles.cache.forEach((role) => {
      // skip @everyone & managed/bot roles
      if (role.id === guild.id) return;
      if (role.managed) return;

      let stat = roleStats.get(role.id);
      if (!stat) {
        stat = { role, count: 0 };
        roleStats.set(role.id, stat);
      }
      stat.count++;
    });
  }

  if (roleStats.size === 0) return null;

  let entries = [...roleStats.values()];

  // Sort by players-with-prefs desc, then by role position
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.role.position - a.role.position;
  });

  // Up to 24 roles (Discord limit 25 options total)
  entries = entries.slice(0, 24);

  const options = [
    {
      label: 'Entire server',
      value: '__ALL__',
      description: 'Show all players with saved preferences'
    },
    ...entries.map((stat) => ({
      label: stat.role.name.slice(0, 100),
      value: stat.role.id,
      description: `${stat.count} player(s) with prefs`
    }))
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId('posprefs_role_select')
    .setPlaceholder('Pick a role (or Entire server) to view the board')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

// =======================
// READY
// =======================

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`✅ App ID: ${c.application.id}`);

  await c.application.commands.set([
    {
      name: 'pospanel',
      description: 'Create the shared position preference panel in this channel.'
    },
    {
      name: 'posboard',
      description:
        'Show saved position preferences for players in your current voice channel.'
    },
    {
      name: 'posprefs',
      description:
        'Open a role selector to view position preferences for parts of the server.'
    }
  ]);

  console.log('✅ Commands registered: /pospanel, /posboard, /posprefs');
});

// =======================
// INTERACTION HANDLER
// =======================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.guildId || !interaction.channelId) return;

    const guildId = interaction.guildId;

    // ---------- SLASH COMMANDS ----------
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      // /pospanel – create the shared panel message in this channel
      if (cmd === 'pospanel') {
        const panelEmbed = new EmbedBuilder()
          .setTitle('📋 Position Preference Panel')
          .setColor(0x57f287)
          .setDescription(
            'Click the button below to open your **personal position preference panel**.\n\n' +
              '• Rank up to **11** positions in order of preference.\n' +
              '• Your preferences are saved per user and per server.\n' +
              '• Other bots (like the spots/formation bot) can auto-use these.\n\n' +
              'Tip: Pin this message so players can easily find it.'
          );

        const panelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('open_prefs')
            .setLabel('Open / Edit My Preferences')
            .setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({
          embeds: [panelEmbed],
          components: [panelRow]
        });
      }

      // /posboard – show prefs for people in your current VC
      if (cmd === 'posboard') {
        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({
            content:
              'Please run this command in a server text channel (not in DMs).',
            ephemeral: true
          });
        }

        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;

        if (!voiceChannel) {
          return interaction.reply({
            content:
              'You need to be **connected to a voice channel** in this server to use `/posboard`.',
            ephemeral: true
          });
        }

        const members = [...voiceChannel.members.values()].filter(
          (m) => !m.user.bot
        );

        if (members.length === 0) {
          return interaction.reply({
            content: 'No players found in your voice channel.',
            ephemeral: true
          });
        }

        // Build position -> list of { userId, rank }
        const posMap = {};
        POSITIONS.forEach((p) => (posMap[p] = []));

        for (const m of members) {
          const prefs = getUserPrefs(guildId, m.id);
          if (!prefs || prefs.length === 0) continue;

          prefs.forEach((pos, index) => {
            if (!posMap[pos]) return;
            const rank = index + 1; // 1..11
            posMap[pos].push({ userId: m.id, rank });
          });
        }

        // Sort by rank then display name per position
        POSITIONS.forEach((pos) => {
          const entries = posMap[pos];
          if (!entries || entries.length === 0) return;
          entries.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            const aMember = members.find((m) => m.id === a.userId);
            const bMember = members.find((m) => m.id === b.userId);
            const aName =
              aMember?.displayName || aMember?.user?.username || a.userId;
            const bName =
              bMember?.displayName || bMember?.user?.username || b.userId;
            return aName.localeCompare(bName);
          });
        });

        const fields = POSITIONS.map((pos) => {
          const meta = POSITION_META[pos];
          const nameEmoji = meta?.emoji || '▫️';
          const title = `${nameEmoji} ${pos}`;
          const value = formatPositionEntries(posMap[pos]);
          return { name: title, value, inline: true };
        });

        const embed = new EmbedBuilder()
          .setTitle('🧩 Position Board – Voice Channel Preferences')
          .setColor(0x5865f2)
          .setDescription(
            `Voice channel: ${voiceChannel} • **${members.length}** player(s)\n` +
              'Sorted by **player preference rank** (1️⃣ = top choice).'
          )
          .addFields(fields)
          .setFooter({
            text: 'Players without saved preferences are not shown.'
          });

        return interaction.reply({
          embeds: [embed]
        });
      }

      // /posprefs – show a role dropdown first (no giant board by default)
      if (cmd === 'posprefs') {
        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({
            content:
              'Please run this command in a server text channel (not in DMs).',
            ephemeral: true
          });
        }

        // Fetch all members (non-bots)
        let members = await guild.members.fetch();
        members = members.filter((m) => !m.user.bot);

        const participants = [];

        for (const m of members.values()) {
          const prefs = getUserPrefs(guildId, m.id);
          if (prefs && prefs.length > 0) {
            participants.push({ member: m, prefs });
          }
        }

        if (participants.length === 0) {
          return interaction.reply({
            content:
              'No players in this server have saved position preferences yet.',
            ephemeral: true
          });
        }

        const row = buildPosPrefsRoleSelect(guild, participants);

        const infoEmbed = new EmbedBuilder()
          .setTitle('🧩 Position Preferences – Select Role')
          .setColor(0x5865f2)
          .setDescription(
            'Use the dropdown below to view **position preference boards**.\n\n' +
              '• Choose a **role** to see only players with that role.\n' +
              '• Choose **Entire server** if you really want the full list (can be large).\n\n' +
              `Players with saved preferences: **${participants.length}**`
          )
          .setFooter({
            text: 'Only players with saved preferences will appear in the boards.'
          });

        return interaction.reply({
          embeds: [infoEmbed],
          components: row ? [row] : []
        });
      }

      // Fallback
      return interaction.reply({
        content: 'Unknown command.',
        ephemeral: true
      });
    }

    // ---------- BUTTONS ----------
    if (interaction.isButton()) {
      const guildIdBtn = interaction.guildId;
      const id = interaction.customId;

      // Open personal prefs panel from the shared channel panel
      if (id === 'open_prefs') {
        const existing = getUserPrefs(guildIdBtn, interaction.user.id);

        return interaction.reply({
          embeds: [buildPrefsEmbed(existing)],
          components: buildPrefComponents(existing),
          ephemeral: true
        });
      }

      // Position buttons: prefpos_ST, prefpos_CAM, etc.
      if (id.startsWith('prefpos_')) {
        const pos = id.replace('prefpos_', '');
        if (!isValidPosition(pos)) return;

        const userId = interaction.user.id;
        const current = getUserPrefs(guildIdBtn, userId);

        let newPrefs = [...current];
        const idx = newPrefs.indexOf(pos);

        if (idx !== -1) {
          // Already selected → remove it
          newPrefs.splice(idx, 1);
        } else {
          // Not selected → add if under limit
          if (newPrefs.length >= PREFS_LIMIT) {
            return interaction.reply({
              content:
                `You already selected **${PREFS_LIMIT}** positions. ` +
                'Click one of your selected positions again to remove it first.',
              ephemeral: true
            });
          }
          newPrefs.push(pos);
        }

        setUserPrefs(guildIdBtn, userId, newPrefs);

        return interaction.update({
          embeds: [buildPrefsEmbed(newPrefs)],
          components: buildPrefComponents(newPrefs)
        });
      }

      // Done button: show a saved summary
      if (id === 'prefs_done') {
        const prefs = getUserPrefs(guildIdBtn, interaction.user.id);
        const hasPrefs = prefs.length > 0;

        const summary = hasPrefs
          ? prefs
              .map((p, i) => {
                const rank = i + 1;
                const rankIcon = RANK_EMOJI[rank] || `${rank}.`;
                const meta = POSITION_META[p];
                const friendly = meta
                  ? `${meta.emoji || ''} **${p}** – ${meta.label}`
                  : `**${p}**`;
                return `${rankIcon} ${friendly}`;
              })
              .join('\n')
          : 'You have no positions selected yet.';

        return interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle('✅ Preferences Saved')
              .setColor(0x57f287)
              .setDescription(
                summary +
                  '\n\nYou can click the panel button again any time to adjust them.'
              )
          ],
          components: [] // remove buttons
        });
      }

      // Clear button – wipe prefs for this guild
      if (id === 'prefs_clear') {
        setUserPrefs(guildIdBtn, interaction.user.id, []);

        return interaction.update({
          embeds: [buildPrefsEmbed([])],
          components: buildPrefComponents([])
        });
      }
    }

    // ---------- SELECT MENUS ----------
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;

      // Role filter for /posprefs
      if (id === 'posprefs_role_select') {
        const guild = interaction.guild;
        const guildIdSel = guild.id;
        const selected = interaction.values[0];

        // Rebuild participants
        let members = await guild.members.fetch();
        members = members.filter((m) => !m.user.bot);

        const participants = [];
        for (const m of members.values()) {
          const prefs = getUserPrefs(guildIdSel, m.id);
          if (prefs && prefs.length > 0) {
            participants.push({ member: m, prefs });
          }
        }

        if (participants.length === 0) {
          return interaction.update({
            content:
              'No players in this server have saved position preferences yet.',
            embeds: [],
            components: []
          });
        }

        const selectedRoleId = selected === '__ALL__' ? null : selected;

        const filteredParticipants = selectedRoleId
          ? participants.filter((p) =>
              p.member.roles.cache.has(selectedRoleId)
            )
          : participants;

        // Build label for title/description
        let label;
        if (!selectedRoleId) {
          label = 'Entire Server';
        } else {
          const role = guild.roles.cache.get(selectedRoleId);
          label = role ? role.name : 'Selected Role';
        }

        if (filteredParticipants.length === 0) {
          const emptyEmbed = new EmbedBuilder()
            .setTitle(`🧩 Position Preferences – ${label}`)
            .setColor(0x5865f2)
            .setDescription(
              `No players with saved position preferences found for **${label}**.`
            );

          const row = buildPosPrefsRoleSelect(guild, participants);

          return interaction.update({
            embeds: [emptyEmbed],
            components: row ? [row] : []
          });
        }

        const embed = buildPosPrefsEmbedForParticipants(
          guild,
          filteredParticipants,
          label
        );

        const row = buildPosPrefsRoleSelect(guild, participants);

        return interaction.update({
          embeds: [embed],
          components: row ? [row] : []
        });
      }
    }
  } catch (err) {
    console.error('❌ Error handling interaction:', err);

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `Error: ${err.message || 'something went wrong.'}`,
          ephemeral: true
        });
      }
    } catch (e) {
      console.error('❌ Failed to send error reply:', e);
    }
  }
});

// =======================
// LOGIN
// =======================

client.login(token);
