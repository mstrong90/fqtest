require('dotenv').config();
const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { getAnalytics, recordPlayTime } = require('./analytics');

// ── Config ───────────────────────────────────────────────────────────────────
const TOKEN      = process.env.BOT_TOKEN;
const GAME_URL   = process.env.GAME_URL;
const PORT       = process.env.PORT || 3000;
const ADMIN_ID   = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : null;

// ── File paths for leaderboards ──────────────────────────────────────────────
const LB_PATH = path.join(__dirname, 'public', 'flappy_quakks', 'leaderboard.json');
const SR_PATH = path.join(__dirname, 'public', 'flappy_quakks', 'sr-leaderboard.json');
console.log('Saving SR scores to →', SR_PATH);

// ── Quakk pick persistence ───────────────────────────────────────────────────
const PICKS_PATH = path.join(__dirname, 'QuakkPicks.json');
if (!fs.existsSync(PICKS_PATH)) {
  fs.writeFileSync(PICKS_PATH, '{}', 'utf8');
}
function readPicks() {
  try {
    return JSON.parse(fs.readFileSync(PICKS_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}
function writePicks(picks) {
  fs.writeFileSync(PICKS_PATH, JSON.stringify(picks, null, 2), 'utf8');
}

// ── In-memory stores ─────────────────────────────────────────────────────────
let leaderboard   = [];
let srLeaderboard = [];

// ── Load/Save helpers ─────────────────────────────────────────────────────────
function loadLeaderboard() {
  try {
    const raw = fs.readFileSync(LB_PATH, 'utf-8');
    const data = JSON.parse(raw);
    leaderboard = Array.isArray(data) ? data : [];
  } catch {
    leaderboard = [];
    saveLeaderboard();
  }
}
function saveLeaderboard() {
  fs.writeFileSync(LB_PATH, JSON.stringify(leaderboard, null, 2), 'utf-8');
}

if (!fs.existsSync(SR_PATH)) {
  fs.writeFileSync(SR_PATH, '[]', 'utf-8');
}
function loadSRLeaderboard() {
  try {
    const raw = fs.readFileSync(SR_PATH, 'utf-8');
    srLeaderboard = JSON.parse(raw);
  } catch {
    srLeaderboard = [];
    saveSRLeaderboard();
  }
}
function saveSRLeaderboard() {
  console.log('🔄 Saving SR leaderboard to:', SR_PATH);
  console.log('   Data:', JSON.stringify(srLeaderboard, null, 2));
  try {
    fs.writeFileSync(SR_PATH, JSON.stringify(srLeaderboard, null, 2), 'utf-8');
    console.log('✅ SR leaderboard saved successfully');
  } catch (err) {
    console.error('❌ Failed to save SR leaderboard:', err);
    throw err;
  }
}

// initialize data stores
loadLeaderboard();
loadSRLeaderboard();

// ── Telegram Bot Setup ────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
bot.on('polling_error', console.error);

// Command pattern for /start and /flap
const cmdPattern = /^\/(start)(@\w+)?$/;
bot.onText(cmdPattern, msg => sendWelcome(msg));
bot.on('callback_query', q => bot.answerCallbackQuery(q.id));

// ── Admin-only Reset Commands ─────────────────────────────────────────────────
bot.onText(/^\/resetclassic(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  leaderboard = [];
  saveLeaderboard();
  bot.sendMessage(chatId, '🦆 Classic leaderboard has been reset.');
});
bot.onText(/^\/resetspeed(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  srLeaderboard = [];
  saveSRLeaderboard();
  bot.sendMessage(chatId, '🦆 Speed-Run leaderboard has been reset.');
});

// ── Admin-only Change Classic Score ──────────────────────────────────────────
bot.onText(/^!changeclassic\s+(\d+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  const newScore = parseInt(match[1], 10);
  const username = '@TheCryptoGuyOG';
  const existing = leaderboard.find(e => e.username === username);
  if (existing) existing.score = newScore;
  else leaderboard.push({ username, score: newScore });
  leaderboard.sort((a,b)=>b.score - a.score);
  leaderboard = leaderboard.slice(0,10);
  saveLeaderboard();
  bot.sendMessage(chatId, `✅ Classic score for ${username} set to ${newScore}.`);
});

// ── Admin-only Change Speed-Run Score ─────────────────────────────────────────
bot.onText(/^!changespeed\s+(\d+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  const newScore = parseInt(match[1], 10);
  const username = '@TheCryptoGuyOG';
  const existing = srLeaderboard.find(e => e.username === username);
  if (existing) existing.score = newScore;
  else srLeaderboard.push({ username, score: newScore });
  srLeaderboard.sort((a,b)=>b.score - a.score);
  srLeaderboard = srLeaderboard.slice(0,10);
  saveSRLeaderboard();
  bot.sendMessage(chatId, `✅ Speed-Run score for ${username} set to ${newScore}.`);
});

// ── Admin-only Kill Command ───────────────────────────────────────────────────
bot.onText(/^!kill\s+(\S+)\s+(classic|speed)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }
  let username = match[1];
  if (!username.startsWith('@')) username = '@' + username;
  const mode = match[2].toLowerCase();
  if (mode === 'classic') {
    const before = leaderboard.length;
    leaderboard = leaderboard.filter(e => e.username !== username);
    if (leaderboard.length < before) {
      saveLeaderboard();
      bot.sendMessage(chatId, `✅ Removed ${username} from Classic leaderboard.`);
    } else {
      bot.sendMessage(chatId, `⚠️ ${username} not found on Classic leaderboard.`);
    }
  } else {
    const before = srLeaderboard.length;
    srLeaderboard = srLeaderboard.filter(e => e.username !== username);
    if (srLeaderboard.length < before) {
      saveSRLeaderboard();
      bot.sendMessage(chatId, `✅ Removed ${username} from Speed-Run leaderboard.`);
    } else {
      bot.sendMessage(chatId, `⚠️ ${username} not found on Speed-Run leaderboard.`);
    }
  }
});

// ── Analytics Command ────────────────────────────────────────────────────────
bot.onText(/^!analytics$/, msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (ADMIN_ID === null || userId !== ADMIN_ID) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this command.');
  }

  getAnalytics((err, rows) => {
    if (err) {
      console.error('Analytics error:', err);
      return bot.sendMessage(chatId, '❌ Failed to fetch analytics.');
    }
    if (rows.length === 0) {
      return bot.sendMessage(chatId, 'ℹ️ No analytics data yet.');
    }

    // helper to turn minutes (float) into HH:MM:SS
    function formatDuration(minutesFloat) {
      const totalSeconds = Math.round(minutesFloat * 60);
      const hrs  = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }

    // build per-user blocks with a blank line after each
    const blocks = [];
    rows.forEach(r => {
      blocks.push(`${r.username}--`);
      blocks.push(`    Classic Score: ${r.classic_high_score}`);
      blocks.push(`    Classic Time: ${formatDuration(r.classic_time_played)}`);
      blocks.push(`    Speed Run Score: ${r.speed_high_score}`);
      blocks.push(`    Speed Run Time: ${formatDuration(r.speed_time_played)}`);
      blocks.push('');  // blank line
    });
    // remove trailing blank line
    if (blocks[blocks.length - 1] === '') blocks.pop();

    // totals
    const totalClassic = formatDuration(
      rows.reduce((sum, r) => sum + r.classic_time_played, 0)
    );
    const totalSpeed   = formatDuration(
      rows.reduce((sum, r) => sum + r.speed_time_played, 0)
    );

    // assemble the message
    const text = [
      '🦆Game Analytics🦆',
      '',
      ...blocks,
      '',
      `Total Classic Time: ${totalClassic}`,
      `Total Speed Run Time: ${totalSpeed}`
    ].join('\n');

    // send as plain text
    bot.sendMessage(chatId, text);
  });
});
// ── sendWelcome ──────────────────────────────────────────────────────────────
function sendWelcome(msg) {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  let button;
  if (isPrivate) {
    button = { text: '▶️ Play Flappy Quakks', web_app: { url: GAME_URL } };
  } else {
    const from = msg.from;
    const uname = from.username ? '@' + from.username : `${from.first_name}_${from.id}`;
    const urlWithUser = `${GAME_URL}?username=${encodeURIComponent(uname)}`;
    button = { text: '▶️ Play Flappy Quakks', url: urlWithUser };
  }
  bot.sendMessage(chatId,
    'Welcome to 🦆 Flappy Quakks!\nTap below to begin.',
    { reply_markup: { inline_keyboard: [[button]] } }
  );
}

// ── Express Server Setup ─────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(
  '/flappy_quakks',
  express.static(path.join(__dirname, 'public', 'flappy_quakks'))
);

// ── Quakk pick endpoints ───────────────────────────────────────────────────
app.get('/flappy_quakks/getQuakk', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username required' });
  const picks = readPicks();
  res.json({ variant: picks[username] ?? null });
});
app.post('/flappy_quakks/selectQuakk', (req, res) => {
  const { username, variant } = req.body;
  if (!username || variant == null) {
    return res.status(400).json({ error: 'username & variant required' });
  }
  const picks = readPicks();
  picks[username] = variant;
  writePicks(picks);
  res.json({ success: true });
});

// ── Classic Leaderboard Endpoints ─────────────────────────────────────────
app.post('/flappy_quakks/submit', (req, res) => {
  const { username, score, durationMs } = req.body;

  // basic validation
  if (typeof username !== 'string' || typeof score !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // update or insert high score
  const existing = leaderboard.find(e => e.username === username);
  if (existing) {
    existing.score = Math.max(existing.score, score);
  } else {
    leaderboard.push({ username, score });
  }
  leaderboard.sort((a, b) => b.score - a.score);

  // persist the full leaderboard
  try {
    saveLeaderboard();
  } catch {
    return res.status(500).json({ error: 'Could not save leaderboard' });
  }

  // record time played if the front-end sent it
  if (typeof durationMs === 'number') {
    recordPlayTime(username, 'classic', durationMs);
  }

  res.json({ status: 'ok' });
});

app.get('/flappy_quakks/leaderboard', (req, res) => {
  // still only send top 10 to the client
  res.json(leaderboard.slice(0, 10));
});

// ── Speed-Run Leaderboard Endpoints ────────────────────────────────────────
app.post('/flappy_quakks/SR-submit', (req, res) => {
  const { username, score, durationMs } = req.body;

  if (typeof username !== 'string' || typeof score !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const existing = srLeaderboard.find(e => e.username === username);
  if (existing) {
    existing.score = Math.max(existing.score, score);
  } else {
    srLeaderboard.push({ username, score });
  }
  srLeaderboard.sort((a, b) => b.score - a.score);

  try {
    saveSRLeaderboard();
  } catch {
    return res.status(500).json({ error: 'Could not save SR leaderboard' });
  }

  if (typeof durationMs === 'number') {
    recordPlayTime(username, 'speed', durationMs);
  }

  res.json({ status: 'ok' });
});

app.get('/flappy_quakks/SR-leaderboard', (req, res) => {
  res.json(srLeaderboard.slice(0, 10));
});

// ── Show Speed-Run Leaderboard ───────────────────────────────────────────────
bot.onText(/^\/speedlead(@\w+)?$/, (msg) => {
  const chatId = msg.chat.id;

  if (srLeaderboard.length === 0) {
    return bot.sendMessage(chatId, 'ℹ️ The Speed-Run leaderboard is currently empty.');
  }

  // build a clean list
  let text = '🏁 Speed-Run Leaderboard 🏁\n\n';
  srLeaderboard.forEach((entry, i) => {
    text += `${i + 1}. ${entry.username}: ${entry.score}\n`;
  });

  bot.sendMessage(chatId, text);
});

// ── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
