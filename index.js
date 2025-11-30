// index.js – Position Preference Bot

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
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

// We need Guilds + GuildVoiceStates so /posboard can see who is in your VC
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
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

// Nice labels/emojis for visuals
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
  return sharedGetUserPrefs(guildId, userId);
}

function setUserPrefs(guildId, userId, prefs) {
  return sharedSetUserPrefs(guildId, userId, prefs);
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
    .setFooter({ text: 'Your preferences are saved automatically.' });
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

// Format entries for /posboard: names are clickable mentions
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
    }
  ]);

  console.log('✅ Commands registered: /pospanel, /posboard');
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
              '• Other bots (like the spot/formation bot) can auto-use these.\n\n' +
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
            flags: MessageFlags.Ephemeral
          });
        }

        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;

        if (!voiceChannel) {
          return interaction.reply({
            content:
              'You need to be **connected to a voice channel** in this server to use `/posboard`.',
            flags: MessageFlags.Ephemeral
          });
        }

        const members = [...voiceChannel.members.values()].filter(
          (m) => !m.user.bot
        );

        if (members.length === 0) {
          return interaction.reply({
            content: 'No players found in your voice channel.',
            flags: MessageFlags.Ephemeral
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

        // Sort by rank then display name
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

      // Fallback
      return interaction.reply({
        content: 'Unknown command.',
        flags: MessageFlags.Ephemeral
      });
    }

    // ---------- BUTTONS ----------
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Open personal prefs panel from the shared channel panel
      if (id === 'open_prefs') {
        const existing = getUserPrefs(guildId, interaction.user.id);

        return interaction.reply({
          embeds: [buildPrefsEmbed(existing)],
          components: buildPrefComponents(existing),
          flags: MessageFlags.Ephemeral
        });
      }

      // Position buttons: prefpos_ST, prefpos_CAM, etc.
      if (id.startsWith('prefpos_')) {
        const pos = id.replace('prefpos_', '');
        if (!isValidPosition(pos)) return;

        const userId = interaction.user.id;
        const current = getUserPrefs(guildId, userId);

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
              flags: MessageFlags.Ephemeral
            });
          }
          newPrefs.push(pos);
        }

        setUserPrefs(guildId, userId, newPrefs);

        return interaction.update({
          embeds: [buildPrefsEmbed(newPrefs)],
          components: buildPrefComponents(newPrefs)
        });
      }

      // Done button: show a saved summary
      if (id === 'prefs_done') {
        const prefs = getUserPrefs(guildId, interaction.user.id);
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
        setUserPrefs(guildId, interaction.user.id, []);

        return interaction.update({
          embeds: [buildPrefsEmbed([])],
          components: buildPrefComponents([])
        });
      }
    }
  } catch (err) {
    console.error('❌ Error handling interaction:', err);

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `Error: ${err.message || 'something went wrong.'}`,
          flags: MessageFlags.Ephemeral
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
