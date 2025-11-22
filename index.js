const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

// ===== BASIC SETUP =====

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

// positionPrefs: Discord user ID -> { prefs: [ 'ST', 'CAM', ... up to 11 ], updatedAt: Date }
const positionPrefs = new Map();

// ===== HELPERS =====

// Build the "your prefs" embed
function buildPrefsEmbed(selected) {
  let desc;
  if (!selected || selected.length === 0) {
    desc =
      'No positions selected yet.\n' +
      'Click the buttons below to add up to **11** positions in order of preference.\n' +
      'Click a selected position again to remove it.';
  } else {
    const lines = selected.map((p, i) => `${i + 1}. **${p}**`).join('\n');
    desc =
      'Your current preferences:\n' +
      lines +
      '\n\nYou can click more buttons to add (up to 11) or click a selected one to remove it.';
  }

  return new EmbedBuilder()
    .setTitle('Rank Your Positions')
    .setDescription(
      desc +
        '\n\nPositions: `ST, RW, LW, CAM, RDM, LDM, LB, LCB, RCB, RB, GK`'
    );
}

// Build the position buttons + control buttons for the prefs panel
function buildPrefComponents(selected) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  POSITIONS.forEach((pos, index) => {
    const isSelected = selected.includes(pos);
    const button = new ButtonBuilder()
      .setCustomId(`prefpos_${pos}`)
      .setLabel(pos)
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);

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

// ===== READY =====

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`✅ App ID: ${c.application.id}`);

  await c.application.commands.set([
    { name: 'prefs', description: 'Open your position preference panel (buttons).' },
    { name: 'draftvc', description: 'Show position preferences for players in your voice channel.' }
  ]);

  console.log('✅ Commands registered: /prefs, /draftvc');
});

// ===== INTERACTIONS =====

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

    // ---------- SLASH COMMANDS ----------
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      // /prefs – open interactive button panel (ephemeral)
      if (cmd === 'prefs') {
        const existing =
          positionPrefs.get(interaction.user.id)?.prefs || [];

        return interaction.reply({
          embeds: [buildPrefsEmbed(existing)],
          components: buildPrefComponents(existing),
          ephemeral: true
        });
      }

      // /draftvc – show preferences for people in your voice channel
      if (cmd === 'draftvc') {
        // Use voice state cache so it works reliably
        const voiceState = interaction.guild.voiceStates.cache.get(
          interaction.user.id
        );
        const voiceChannel = voiceState?.channel;

        if (!voiceChannel) {
          return interaction.reply({
            content:
              'You need to be **connected to a voice channel** in this server to use this.',
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

        members.forEach((m) => {
          const prefs = positionPrefs.get(m.id);
          if (!prefs || !prefs.prefs || prefs.prefs.length === 0) return;

          prefs.prefs.forEach((pos, index) => {
            if (!posMap[pos]) return;
            const rank = index + 1; // 1..11
            posMap[pos].push({ member: m, rank });
          });
        });

        const rankEmoji = {
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
        };

        const sections = POSITIONS.map((pos) => {
          const entries = posMap[pos];
          if (!entries || entries.length === 0) {
            return `**${pos}** – no data`;
          }

          // Sort by rank (1 -> 11), then by displayName
          entries.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.member.displayName.localeCompare(
              b.member.displayName
            );
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

    // ---------- BUTTONS (prefs panel) ----------
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Position buttons: prefpos_ST, prefpos_CAM, etc.
      if (id.startsWith('prefpos_')) {
        const pos = id.replace('prefpos_', '');
        if (!POSITIONS.includes(pos)) return;

        const userId = interaction.user.id;
        const current = positionPrefs.get(userId)?.prefs || [];

        let newPrefs = [...current];
        const idx = newPrefs.indexOf(pos);

        if (idx !== -1) {
          // Already selected → remove it
          newPrefs.splice(idx, 1);
        } else {
          // Not selected → add if under 11
          if (newPrefs.length >= 11) {
            // Use ephemeral reply, but since this is a button interaction,
            // we need to reply separately (not update the main message)
            return interaction.reply({
              content:
                'You already selected 11 positions. Click one of your selected positions again to remove it first.',
              ephemeral: true
            });
          }
          newPrefs.push(pos);
        }

        positionPrefs.set(userId, {
          prefs: newPrefs,
          updatedAt: new Date()
        });

        return interaction.update({
          embeds: [buildPrefsEmbed(newPrefs)],
          components: buildPrefComponents(newPrefs)
        });
      }

      // Done button
      if (id === 'prefs_done') {
        const prefs = positionPrefs.get(interaction.user.id)?.prefs || [];
        const summary =
          prefs.length === 0
            ? 'You have no positions selected yet.'
            : 'Your saved preferences:\n' +
              prefs.map((p, i) => `${i + 1}. **${p}**`).join('\n');

        return interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle('Preferences Saved')
              .setDescription(
                summary +
                  '\n\nYou can run `/prefs` again any time to adjust them.'
              )
          ],
          components: [] // remove buttons
        });
      }

      // Clear button
      if (id === 'prefs_clear') {
        positionPrefs.set(interaction.user.id, {
          prefs: [],
          updatedAt: new Date()
        });

        return interaction.update({
          embeds: [buildPrefsEmbed([])],
          components: buildPrefComponents([])
        });
      }
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
