// analytics.js
const path   = require('path');
const sqlite = require('sqlite3').verbose();
const DB_PATH = path.resolve(__dirname, 'analytics.db');

const db = new sqlite.Database(DB_PATH, err => {
  if (err) console.error('❌ Failed to open analytics.db', err);
  else console.log('✅ analytics.db ready');
});

// Initialize schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      username             TEXT    UNIQUE,
      classic_high_score   INTEGER DEFAULT 0,
      speed_high_score     INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS play_times (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER,
      mode      TEXT    CHECK(mode IN ('classic','speed')),
      play_time REAL,            -- duration in MINUTES
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(player_id) REFERENCES players(id)
    )
  `);
});

/**
 * Record a single play session duration.
 * @param {string} username 
 * @param {'classic'|'speed'} mode 
 * 
 */
function recordPlayTime(username, mode, durationMs) {
  const minutes = durationMs / 60000;

    db.serialize(() => {
    db.run(
      `INSERT OR IGNORE INTO players(username) VALUES(?)`,
      [username],
      err => { if (err) console.error('❌ recordPlayTime → players insert', err); }
    );

    db.run(
      `INSERT INTO play_times(player_id, mode, play_time)
       VALUES(
         (SELECT id FROM players WHERE username = ?),
         ?, 
         ?
       )`,
      [username, mode, minutes],
      err => { if (err) console.error('❌ recordPlayTime → play_times insert', err); }
    );
  });
}

/**
 * Record or update the high score for a mode.
 * @param {string} username
 * @param {'classic'|'speed'} mode
 * @param {number} score
 */
function recordHighScore(username, mode, score) {
  db.serialize(() => {
    db.run(
      `INSERT OR IGNORE INTO players(username) VALUES(?)`,
      [username]
    );

    const column = mode === 'classic'
      ? 'classic_high_score'
      : 'speed_high_score';

    db.run(
      `UPDATE players
       SET ${column} = MAX(${column}, ?)
       WHERE username = ?`,
      [score, username],
      err => { if (err) console.error('❌ recordHighScore', err); }
    );
  });
}

/**
 * Get a summary report with totals and highs.
 * @param {function(Error, Array)} callback
 */
function getAnalytics(callback) {
  const sql = `
    SELECT
      p.username,
      p.classic_high_score,
      p.speed_high_score,
      ROUND(
        IFNULL(SUM(CASE WHEN pt.mode='classic' THEN pt.play_time END) / 60000, 0),
        2
      ) AS classic_minutes,
      ROUND(
        IFNULL(SUM(CASE WHEN pt.mode='speed'   THEN pt.play_time END) / 60000, 0),
        2
      ) AS speed_minutes
    FROM players p
    LEFT JOIN play_times pt ON pt.player_id = p.id
    GROUP BY p.username
    ORDER BY p.username
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return callback(err);
    callback(null, rows);
  });
}

module.exports = { recordPlayTime, recordHighScore, getAnalytics };