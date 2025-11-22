const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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

// Include GuildVoiceStates so we can see who is in VC
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

// positionPrefs: Discord user ID -> { prefs: [ 'ST', 'CAM', ... up to 6 ], updatedAt: Date }
const positionPrefs = new Map();

// Normalize and validate a position string
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
    { name: 'prefs', description: 'Show panel so players can rank their positions.' },
    { name: 'draftvc', description: 'Show position preferences for players in your voice channel.' }
  ]);

  console.log('✅ Commands registered: /prefs, /draftvc');
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

        const members = [...voiceChannel.members.values()].filter((m) => !m.user.bot);

        if (members.length === 0) {
          return interaction.reply({
            content: 'No players found in your voice channel.',
            ephemeral: true
          });
        }

        // Build position -> list of { member, rank }
        const posMap = {};
        POSITIONS.forEach((p) => (posMap[p] = []));

        members.forEach((m) => {
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

        const sections = POSITIONS.map((pos) => {
          const entries = posMap[pos];
          if (!entries || entries.length === 0) {
            return `**${pos}** – no data`;
          }

          // Sort by rank (1 -> 6), then by displayName
          entries.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.member.displayName.localeCompare(b.member.displayName);
          });

          const lines = entries.map((e) => {
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

    // ===== MODAL SUBMIT (position preferences) =====
    if (interaction.isModalSubmit()) {
      if (interaction.customId !== 'pos_prefs_modal') return;

      const raw = interaction.fields.getTextInputValue('pref_lines') || '';
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
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
