// sharedPositionPrefs.js
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'positionPrefsData.json');

// store = { [guildId]: { [userId]: { prefs: string[], updatedAt: ISOString } } }
let store = {};

// Load existing data (best-effort)
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    store = JSON.parse(raw);
  }
} catch (err) {
  console.error('⚠️ Failed to load positionPrefsData.json, starting empty:', err);
  store = {};
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️ Failed to save positionPrefsData.json:', err);
  }
}

/**
 * Get a user's prefs for a guild.
 * @param {string} guildId
 * @param {string} userId
 * @returns {string[]} e.g. ["ST","RW","CAM"]
 */
function getUserPrefs(guildId, userId) {
  if (!guildId || !userId) return [];
  return store[guildId]?.[userId]?.prefs ?? [];
}

/**
 * Set a user's prefs for a guild.
 * @param {string} guildId
 * @param {string} userId
 * @param {string[]} prefs
 */
function setUserPrefs(guildId, userId, prefs) {
  if (!guildId || !userId) return;
  if (!Array.isArray(prefs)) prefs = [];
  if (!store[guildId]) store[guildId] = {};
  store[guildId][userId] = {
    prefs,
    updatedAt: new Date().toISOString()
  };
  save();
}

module.exports = {
  getUserPrefs,
  setUserPrefs
};
