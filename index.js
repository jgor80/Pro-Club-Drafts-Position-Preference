const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

// =======================
// BASIC SETUP
// =======================

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN env var not set');
  process.exit(1);
}

// Need Guilds + GuildVoiceStates so we can see who is in voice channels
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

// Extra metadata for visuals
const POSITION_META = Object.freeze({
  ST: { emoji: '⚽', label: 'Striker' },
  RW: { emoji: '🏃‍♂️', label: 'Right Wing' },
  LW: { emoji: '🏃‍♂️', label: 'Left Wing' },
  CAM: { emoji: '🎯', label: 'Attacking Midfielder' },
  RDM: { emoji: '🛡️', label: 'Right Defensive Mid' },
  LDM: { emoji: '🛡️', label: 'Left Defensive Mid' },
  LB: { emoji: '🧱', label: 'Left Back' },
  LCB: { emoji: '🧱', label: 'Left Centre Back' },
  RCB: { emoji: '🧱', label: 'Right Centre Back' },
  RB: { emoji: '🧱', label: 'Right Back' },
  GK: { emoji: '🧤', label: 'Goalkeeper' }
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

// positionPrefs: Discord user ID -> { prefs: [ 'ST', 'CAM', ... ], updatedAt: Date }
const positionPrefs = new Map();

// =======================
// SMALL HELPERS
// =======================

function isValidPosition(pos) {
  return POSITIONS.includes(pos);
}

function getUserPrefs(userId) {
  return positionPrefs.get(userId)?.prefs ?? [];
}

function setUserPrefs(userId, prefs) {
  positionPrefs.set(userId, {
    prefs,
    updatedAt: new Date()
  });
}

// Build a neat progress bar like: █████░░░░░ (10 slots)
function buildProgressBar(current, max, length = 10) {
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

  let descHeader =
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
      const friendly =
        meta ? `${meta.emoji || ''} **${pos}** – ${meta.label}` : `**${pos}**`;
      return `${rankIcon} ${friendly}`;
    });

    body =
      'Your current preferences:\n' +
      lines.join('\n') +
      '\n\nYou can click more buttons to add (up to 11) or click a selected one to remove it.';
  }

  return new EmbedBuilder()
    .setTitle('🎮 Rank Your Positions')
    .setColor(0x5865f2) // Discord blurple style
    .setDescription(
      descHeader +
        body +
        '\n\nAvailable positions:\n`ST, RW, LW, CAM, RDM, LDM, LB, LCB, RCB, RB, GK`'
    )
    .setFooter({ text: 'Your preferences are saved automatically.' });
}

// Build the position buttons + control buttons for the prefs panel
function buildPrefComponents(selected) {
  const list = selected || [];
  const rows = [];
  let currentRow = new ActionRowBuilder();

  POSITIONS.forEach((pos, index) => {
    const isSelected = list.includes(pos);
    const meta = POSITION_META[pos];
    const label = meta ? pos : pos;
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

  // Control row: Done / Clear
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

// Format entries for a given position for /draftvc embed.
// Ensures we don't blow past the 1024-char field limit.
function formatPositionEntries(entries) {
  if (!entries || entries.length === 0) {
    return '*No data yet*';
  }

  const lines = entries.map((e) => {
    const emoji = RANK_EMOJI[e.rank] || `${e.rank}.`;
    return `${emoji} ${e.member.displayName}`;
  });

  let text = lines.join('\n');

  // Hard cap for safety in case of huge voice channels
  const MAX = 950;
  if (text.length <= MAX) return text;

  // Trim lines until we're under the cap
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

  // /positionpanel: shared panel in a text channel
  // /draftvc: uses saved prefs for players in VC
  await c.application.commands.set([
    {
      name: 'positionpanel',
      description: 'Create a shared position preference panel in this channel.'
    },
    {
      name: 'draftvc',
      description:
        'Show position preferences for players in your current voice channel.'
    }
  ]);

  console.log('✅ Commands registered: /positionpanel, /draftvc');
});

// =======================
// INTERACTION HANDLER
// =======================

client.on(Events.InteractionCreate, async (interaction) => {
  console.log('🔔 Interaction received:', {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    type: interaction.type,
    commandName: interaction.commandName,
    customId: interaction.customId
  });

  try {
    // Ignore DMs
    if (!interaction.guildId || !interaction.channelId) return;

    // ---------- SLASH COMMANDS ----------
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      // /positionpanel – create the shared panel message in this channel
      if (cmd === 'positionpanel') {
        const panelEmbed = new EmbedBuilder()
          .setTitle('📋 Position Preference Panel')
          .setColor(0x57f287) // greenish
          .setDescription(
            'Click the button below to open your **personal position preference panel**.\n\n' +
              '• Rank up to **11** positions in order of preference.\n' +
              '• Your preferences are saved per user.\n' +
              '• `/draftvc` uses these rankings to help with drafting teams.\n\n' +
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

      // /draftvc – show preferences for people in your voice channel
      if (cmd === 'draftvc') {
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

        console.log('🎧 Voice debug:', {
          hasGuild: !!guild,
          hasMember: !!member,
          voiceChannelId: voiceChannel?.id || null
        });

        if (!voiceChannel) {
          return interaction.reply({
            content:
              'You need to be **connected to a voice channel** in this server to use this. Join a voice channel, then run `/draftvc` again.',
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

        // Build position -> list of { member, rank }
        const posMap = {};
        POSITIONS.forEach((p) => (posMap[p] = []));

        for (const m of members) {
          const prefs = getUserPrefs(m.id);
          if (!prefs || prefs.length === 0) continue;

          prefs.forEach((pos, index) => {
            if (!posMap[pos]) return;
            const rank = index + 1; // 1..11
            posMap[pos].push({ member: m, rank });
          });
        }

        // For each position, sort by rank then name
        POSITIONS.forEach((pos) => {
          const entries = posMap[pos];
          if (!entries || entries.length === 0) return;
          entries.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.member.displayName.localeCompare(
              b.member.displayName
            );
          });
        });

        // Build an embed with one inline field per position
        const fields = POSITIONS.map((pos) => {
          const meta = POSITION_META[pos];
          const nameEmoji = meta?.emoji || '▫️';
          const title = `${nameEmoji} ${pos}`;
          const value = formatPositionEntries(posMap[pos]);
          return { name: title, value, inline: true };
        });

        const embed = new EmbedBuilder()
          .setTitle('🧩 Draft Helper – Position Preferences')
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
          embeds: [embed],
          ephemeral: false
        });
      }

      // Fallback if some unknown command sneaks through
      return interaction.reply({
        content: 'Unknown command.',
        ephemeral: true
      });
    }

    // ---------- BUTTONS ----------
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Open personal prefs panel from the shared channel panel
      if (id === 'open_prefs') {
        const existing = getUserPrefs(interaction.user.id);

        return interaction.reply({
          embeds: [buildPrefsEmbed(existing)],
          components: buildPrefComponents(existing),
          ephemeral: true
        });
      }

      // Position buttons: prefpos_ST, prefpos_CAM, etc. (inside the *ephemeral* panel)
      if (id.startsWith('prefpos_')) {
        const pos = id.replace('prefpos_', '');
        if (!isValidPosition(pos)) return;

        const userId = interaction.user.id;
        const current = getUserPrefs(userId);

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

        setUserPrefs(userId, newPrefs);

        // Update the ephemeral personal panel
        return interaction.update({
          embeds: [buildPrefsEmbed(newPrefs)],
          components: buildPrefComponents(newPrefs)
        });
      }

      // Done button (in the personal panel)
      if (id === 'prefs_done') {
        const prefs = getUserPrefs(interaction.user.id);
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
                  '\n\nYou can click the **Open / Edit My Preferences** ' +
                  'button in the position panel again any time to adjust them.'
              )
          ],
          components: [] // remove buttons from the personal panel
        });
      }

      // Clear button (in the personal panel)
      if (id === 'prefs_clear') {
        setUserPrefs(interaction.user.id, []);

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
