const path = require('path');
const fs = require('fs');
const sqlite = require('sqlite3').verbose();

// Paths
const DB_PATH = path.resolve(__dirname, 'analytics.db');
const PLAY_TIMES_PATH = path.resolve(__dirname, 'public', 'flappy_quakks', 'play-times.json');

// Open DB
const db = new sqlite.Database(DB_PATH, err => {
  if (err) {
    console.error('❌ Failed to open analytics.db', err);
    process.exit(1);
  }
  console.log('✅ analytics.db opened for migration');
});

// Migrate play times
db.all(`
  SELECT
    p.username,
    pt.mode,
    SUM(pt.play_time) AS total_play_time
  FROM play_times pt
  JOIN players p ON pt.player_id = p.id
  GROUP BY p.username, pt.mode
  ORDER BY p.username
`, [], (err, rows) => {
  if (err) {
    console.error('❌ Failed to query play_times', err);
    process.exit(1);
  }

  // Aggregate play times by username
  const playTimes = [];
  const users = [...new Set(rows.map(r => r.username))];
  users.forEach(username => {
    const classicTime = rows.find(r => r.username === username && r.mode === 'classic')?.total_play_time || 0;
    const speedTime = rows.find(r => r.username === username && r.mode === 'speed')?.total_play_time || 0;
    playTimes.push({
      username,
      classic_time_played: parseFloat(classicTime.toFixed(2)),
      speed_time_played: parseFloat(speedTime.toFixed(2))
    });
  });

  // Save to play-times.json
  try {
    fs.writeFileSync(PLAY_TIMES_PATH, JSON.stringify(playTimes, null, 2), 'utf8');
    console.log(`✅ Saved ${playTimes.length} user play time records to ${PLAY_TIMES_PATH}`);
  } catch (e) {
    console.error('❌ Failed to save play-times.json', e);
    process.exit(1);
  }

  // Close DB
  db.close(err => {
    if (err) console.error('❌ Failed to close analytics.db', err);
    else console.log('✅ Migration complete, analytics.db closed');
  });
});