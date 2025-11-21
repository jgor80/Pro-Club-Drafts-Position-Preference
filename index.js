const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

// Get token from environment variable only
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN env var not set');
  process.exit(1);
}

// IMPORTANT: include GuildVoiceStates so we can see who is in VC
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

// Positions to track
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

// Club definitions (keys + pretty names + shortcode commands)
const CLUBS = [
  { key: 'rs',  name: 'Rush Superstars',  command: 'rs'  },
  { key: 'rs1', name: 'RushSuperstars1',  command: 'rs1' },
  { key: 'rs2', name: 'RushSuperstars2',  command: 'rs2' },
  { key: 'rs3', name: 'RushSuperstars3',  command: 'rs3' },
  { key: 'rsa', name: 'RS Academy',       command: 'rsa' }
];

function getClubByKey(key) {
  return CLUBS.find(c => c.key === key);
}
function getClubByCommand(cmd) {
  return CLUBS.find(c => c.command === cmd);
}

// ====== DIV / CLUB BOARD STATE ======

// Global multi-club board state:
// clubKey -> { spots: { [pos]: boolean } }
const boardState = {};
CLUBS.forEach(club => {
  boardState[club.key] = {
    spots: POSITIONS.reduce((acc, p) => {
      acc[p] = true; // true = OPEN
      return acc;
    }, {})
  };
});

// Which club the admin panel is currently editing
let currentClubKey = 'rs';

// Track the admin panel message so we can update it
let adminPanelChannelId = null;
let adminPanelMessageId = null;

// Build the main embed for a given club key
function buildEmbedForClub(clubKey) {
  const club = getClubByKey(clubKey);
  if (!club) {
    throw new Error(`Unknown club key: ${clubKey}`);
  }

  const clubBoard = boardState[clubKey];
  const lines = POSITIONS.map((p) => {
    const open = clubBoard.spots[p];
    const emoji = open ? '🟢' : '🔴';
    const text = open ? 'OPEN' : 'TAKEN';
    return `**${p}** – ${emoji} ${text}`;
  });

  return new EmbedBuilder()
    .setTitle('Div Spots')
    .setDescription(`**Club:** ${club.name}\n\n` + lines.join('\n'))
    .setFooter({ text: 'Admins: use the panel to change spots/club.' });
}

// Build position buttons (for the CURRENT club in the panel)
function buildButtons() {
  const clubBoard = boardState[currentClubKey];
  const rows = [];
  let currentRow = new ActionRowBuilder();

  POSITIONS.forEach((p, index) => {
    const open = clubBoard.spots[p];
    const button = new ButtonBuilder()
      .setCustomId(`pos_${p}`)
      .setLabel(p)
      .setStyle(open ? ButtonStyle.Success : ButtonStyle.Danger); // green=open, red=taken

    currentRow.addComponents(button);

    if (currentRow.components.length === 5 || index === POSITIONS.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });

  return rows;
}

// Build club dropdown (for admin panel)
function buildClubSelect() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('club_select')
    .setPlaceholder('Select club')
    .addOptions(
      CLUBS.map((club) => ({
        label: club.name,
        value: club.key,
        default: club.key === currentClubKey
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);
  return row;
}

// Components for the admin panel (dropdown + buttons)
function buildAdminComponents() {
  const clubRow = buildClubSelect();
  const buttonRows = buildButtons();
  return [clubRow, ...buttonRows];
}

// ====== POSITION PREFERENCES FOR DRAFTS ======
//
// positionPrefs: Discord user ID -> {
//   prefs: [ 'ST', 'CAM', ... up to 6 ],
//   updatedAt: Date
// }

const positionPrefs = new Map();

// Helper: normalize and validate position string
function normalizePosition(input) {
  if (!input) return null;
  const pos = input.trim().toUpperCase();
  if (!POSITIONS.includes(pos)) return null;
  return pos;
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`✅ App ID: ${c.application.id}`);

  await c.application.commands.set([
    // Div / club controls
    { name: 'div', description: 'Show Div spots for the current club (read-only).' },
    { name: 'divpanel', description: 'Create the admin control panel for Div spots.' },
    { name: 'divall', description: 'Set all spots to OPEN for the current club.' },

    // Shortcodes for specific clubs
    { name: 'rs',  description: 'Show Rush Superstars spots.' },
    { name: 'rs1', description: 'Show RushSuperstars1 spots.' },
    { name: 'rsa', description: 'Show RS Academy spots.' },
    { name: 'rs2', description: 'Show RushSuperstars2 spots.' },
    { name: 'rs3', description: 'Show RushSuperstars3 spots.' },

    // Pref panel + draft helper
    { name: 'prefs', description: 'Show panel so players can rank their positions.' },
    { name: 'draftvc', description: 'Show position preferences for players in your voice channel.' }
  ]);

  console.log('✅ Commands registered: /div, /divpanel, /divall, /rs, /rs1, /rsa, /rs2, /rs3, /prefs, /draftvc');
});

client.on(Events.InteractionCreate, async (interaction) => {
  console.log('🔔 Interaction received:', {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    type: interaction.type,
    commandName: interaction.commandName,
    customId: interaction.customId
  });

  try {
    if (!interaction.guildId || !interaction.channelId) return;

    // ===== SLASH COMMANDS =====
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      // Generic "current club" view
      if (cmd === 'div') {
        return interaction.reply({
          embeds: [buildEmbedForClub(currentClubKey)],
          components: [] // read-only
        });
      }

      // Admin: create panel
      if (cmd === 'divpanel') {
        if (
          !interaction.memberPermissions?.has(
            PermissionsBitField.Flags.ManageGuild
          )
        ) {
          return interaction.reply({
            content: 'Only admins can create the control panel.',
            ephemeral: true
          });
        }

        const msg = await interaction.reply({
          embeds: [buildEmbedForClub(currentClubKey)],
          components: buildAdminComponents(),
          fetchReply: true
        });

        adminPanelChannelId = interaction.channelId;
        adminPanelMessageId = msg.id;

        console.log('✅ Admin panel created at', {
          channelId: adminPanelChannelId,
          messageId: adminPanelMessageId
        });

        return;
      }

      // Admin: reset current club
      if (cmd === 'divall') {
        if (
          !interaction.memberPermissions?.has(
            PermissionsBitField.Flags.ManageGuild
          )
        ) {
          return interaction.reply({
            content: 'Only admins can reset spots.',
            ephemeral: true
          });
        }

        const clubBoard = boardState[currentClubKey];
        POSITIONS.forEach((p) => (clubBoard.spots[p] = true));

        // Update admin panel if it exists
        if (adminPanelChannelId && adminPanelMessageId) {
          try {
            const channel = await client.channels.fetch(adminPanelChannelId);
            const msg = await channel.messages.fetch(adminPanelMessageId);
            await msg.edit({
              embeds: [buildEmbedForClub(currentClubKey)],
              components: buildAdminComponents()
            });
          } catch (err) {
            console.error('⚠️ Failed to update admin panel after /divall:', err);
          }
        }

        return interaction.reply({
          content: 'All spots set to 🟢 OPEN for the current club.',
          ephemeral: true
        });
      }

      // Shortcodes for specific clubs: /rs, /rs1, /rs2, /rs3, /rsa
      const shortcodeClub = getClubByCommand(cmd);
      if (shortcodeClub) {
        return interaction.reply({
          embeds: [buildEmbedForClub(shortcodeClub.key)],
          components: [] // read-only
        });
      }

      // /prefs – show "Rank My Positions" panel
      if (cmd === 'prefs') {
        const embed = new EmbedBuilder()
          .setTitle('Rank Your Positions')
          .setDescription(
            'Click the button below and enter up to 6 positions in order of preference.\n' +
            'Use codes like: ST, RW, LW, CAM, RDM, LDM, LB, LCB, RCB, RB, GK.\n\n' +
            '**Format:** one position per line (top = most wanted).'
          );

        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('rank_positions')
            .setLabel('Rank My Positions')
            .setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({
          embeds: [embed],
          components: [buttonRow]
        });
      }

      // /draftvc – show preferences for people in your voice channel
      if (cmd === 'draftvc') {
        const member = interaction.member;
        const voiceChannel = member.voice?.channel;

        if (!voiceChannel) {
          return interaction.reply({
            content: 'You need to be in a voice channel to use this.',
            ephemeral: true
          });
        }

        const members = [...voiceChannel.members.values()].filter(m => !m.user.bot);

        if (members.length === 0) {
          return interaction.reply({
            content: 'No players found in your voice channel.',
            ephemeral: true
          });
        }

        // Build position -> list of { member, rank }
        const posMap = {};
        POSITIONS.forEach(p => (posMap[p] = []));

        members.forEach(m => {
          const prefs = positionPrefs.get(m.id);
          if (!prefs || !prefs.prefs || prefs.prefs.length === 0) return;

          prefs.prefs.forEach((pos, index) => {
            if (!posMap[pos]) return;
            const rank = index + 1; // 1..6
            posMap[pos].push({ member: m, rank });
          });
        });

        const rankEmoji = {
          1: '1️⃣',
          2: '2️⃣',
          3: '3️⃣',
          4: '4️⃣',
          5: '5️⃣',
          6: '6️⃣'
        };

        const sections = POSITIONS.map(pos => {
          const entries = posMap[pos];
          if (!entries || entries.length === 0) {
            return `**${pos}** – no data`;
          }

          // sort by rank (1 -> 6), then by name
          entries.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.member.displayName.localeCompare(b.member.displayName);
          });

          const lines = entries.map(e => {
            const emoji = rankEmoji[e.rank] || `${e.rank}.`;
            return `${emoji} ${e.member.displayName}`;
          });

          return `**${pos}**\n${lines.join('\n')}`;
        });

        const embed = new EmbedBuilder()
          .setTitle('Draft Helper – Position Preferences (Voice Channel)')
          .setDescription(sections.join('\n\n'));

        return interaction.reply({
          embeds: [embed],
          ephemeral: false
        });
      }
    }

    // ===== BUTTONS =====
    if (interaction.isButton()) {
      const [prefix, rest] = interaction.customId.split('_');

      // Div panel buttons (pos_ST, pos_CAM, etc.)
      if (prefix === 'pos') {
        const pos = rest;
        const clubBoard = boardState[currentClubKey];
        if (!clubBoard || !clubBoard.spots.hasOwnProperty(pos)) return;

        if (
          !interaction.memberPermissions?.has(
            PermissionsBitField.Flags.ManageGuild
          )
        ) {
          return interaction.reply({
            content: 'Only admins can change spots.',
            ephemeral: true
          });
        }

        clubBoard.spots[pos] = !clubBoard.spots[pos];

        return interaction.update({
          embeds: [buildEmbedForClub(currentClubKey)],
          components: buildAdminComponents()
        });
      }

      // rank_positions – open modal for that user
      if (interaction.customId === 'rank_positions') {
        const modal = new ModalBuilder()
          .setCustomId('pos_prefs_modal')
          .setTitle('Rank Your Positions');

        const input = new TextInputBuilder()
          .setCustomId('pref_lines')
          .setLabel('Up to 6 positions (one per line)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Example:\nST\nCAM\nRW\nRCB\nLB\nGK');

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);

        return interaction.showModal(modal);
      }
    }

    // ===== DROPDOWN (club_select) =====
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== 'club_select') return;

      if (
        !interaction.memberPermissions?.has(
          PermissionsBitField.Flags.ManageGuild
        )
      ) {
        return interaction.reply({
          content: 'Only admins can change the club.',
          ephemeral: true
        });
      }

      const selectedKey = interaction.values[0];
      const club = getClubByKey(selectedKey);
      if (!club) {
        return interaction.reply({
          content: 'Unknown club selected.',
          ephemeral: true
        });
      }

      currentClubKey = selectedKey;

      return interaction.update({
        embeds: [buildEmbedForClub(currentClubKey)],
        components: buildAdminComponents()
      });
    }

    // ===== MODAL SUBMIT (position preferences) =====
    if (interaction.isModalSubmit()) {
      if (interaction.customId !== 'pos_prefs_modal') return;

      const raw = interaction.fields.getTextInputValue('pref_lines') || '';
      const lines = raw
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .slice(0, 6); // up to 6 prefs

      if (lines.length === 0) {
        return interaction.reply({
          content: 'Please provide at least one position.',
          ephemeral: true
        });
      }

      const prefs = [];
      for (const line of lines) {
        const pos = normalizePosition(line);
        if (!pos) {
          return interaction.reply({
            content: `Invalid position "${line}". Use codes like ST, CAM, RW, GK, etc.`,
            ephemeral: true
          });
        }
        prefs.push(pos);
      }

      // ensure no duplicates
      const unique = new Set(prefs);
      if (unique.size !== prefs.length) {
        return interaction.reply({
          content: 'Please do not repeat the same position. All choices must be different.',
          ephemeral: true
        });
      }

      positionPrefs.set(interaction.user.id, {
        prefs,
        updatedAt: new Date()
      });

      const linesOut = prefs.map((p, i) => `${i + 1}. ${p}`).join('\n');

      return interaction.reply({
        content: `Saved your preferences:\n${linesOut}`,
        ephemeral: true
      });
    }
  } catch (err) {
    console.error('❌ Error handling interaction:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Error.',
        ephemeral: true
      });
    }
  }
});

client.login(token);
