const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'neondiary.db');

// Ensure upload directories exist
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const photosDir = path.join(uploadsDir, 'photos');
const musicDir = path.join(uploadsDir, 'music');

[photosDir, musicDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

let db = null;

// Initialize database
async function initDB() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS diaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      date TEXT NOT NULL,
      photos TEXT DEFAULT '[]',
      music TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT DEFAULT 'admin',
      password TEXT DEFAULT ''
    )
  `);
  
  // Default admin if not exists
  const adminExists = db.exec("SELECT * FROM admin WHERE username = 'admin'");
  if (adminExists.length === 0 || adminExists[0].values.length === 0) {
    const bcrypt = require('bcryptjs');
    const hashedPassword = bcrypt.hashSync('neondiary2024', 10);
    db.run('INSERT INTO admin (username, password) VALUES (?, ?)', ['admin', hashedPassword]);
  }
  
  saveDB();
}

function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.use(session({
  secret: process.env.SESSION_SECRET || 'neondiarysecret2024',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'photos') {
      cb(null, photosDir);
    } else if (file.fieldname === 'music') {
      cb(null, musicDir);
    } else {
      cb(null, uploadsDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session.adminLoggedIn) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// ============ API ROUTES ============

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const bcrypt = require('bcryptjs');
  
  const result = db.exec("SELECT * FROM admin WHERE username = 'admin'");
  
  if (result.length > 0 && result[0].values.length > 0) {
    const admin = result[0].values[0];
    const storedPassword = admin[2];
    
    if (bcrypt.compareSync(password, storedPassword)) {
      req.session.adminLoggedIn = true;
      res.json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth status
app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!req.session.adminLoggedIn });
});

// Get all diaries (for visitors)
app.get('/api/diaries', (req, res) => {
  const result = db.exec('SELECT * FROM diaries ORDER BY date DESC, created_at DESC');
  
  if (result.length === 0) {
    return res.json([]);
  }
  
  const columns = result[0].columns;
  const diaries = result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      if (col === 'photos' || col === 'music') {
        obj[col] = JSON.parse(row[i] || '[]');
      } else {
        obj[col] = row[i];
      }
    });
    return obj;
  });
  
  res.json(diaries);
});

// Get single diary
app.get('/api/diaries/:id', (req, res) => {
  const result = db.exec(`SELECT * FROM diaries WHERE id = ${req.params.id}`);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return res.json(null);
  }
  
  const columns = result[0].columns;
  const row = result[0].values[0];
  const diary = {};
  columns.forEach((col, i) => {
    if (col === 'photos' || col === 'music') {
      diary[col] = JSON.parse(row[i] || '[]');
    } else {
      diary[col] = row[i];
    }
  });
  
  res.json(diary);
});

// Create diary (admin only)
app.post('/api/diaries', requireAuth, upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'music', maxCount: 10 }]), (req, res) => {
  const { title, content, date } = req.body;
  
  const photos = req.files['photos'] ? req.files['photos'].map(f => `/uploads/photos/${f.filename}`) : [];
  const music = req.files['music'] ? req.files['music'].map(f => `/uploads/music/${f.filename}`) : [];
  
  db.run(
    'INSERT INTO diaries (title, content, date, photos, music) VALUES (?, ?, ?, ?, ?)',
    [title, content, date, JSON.stringify(photos), JSON.stringify(music)]
  );
  
  const lastId = db.exec('SELECT last_insert_rowid() as id');
  saveDB();
  
  res.json({ success: true, id: lastId[0].values[0][0] });
});

// Update diary (admin only)
app.put('/api/diaries/:id', requireAuth, upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'music', maxCount: 10 }]), (req, res) => {
  const { title, content, date, existingPhotos, existingMusic } = req.body;
  
  let photos = existingPhotos ? JSON.parse(existingPhotos) : [];
  let music = existingMusic ? JSON.parse(existingMusic) : [];
  
  if (req.files['photos']) {
    const newPhotos = req.files['photos'].map(f => `/uploads/photos/${f.filename}`);
    photos = [...photos, ...newPhotos];
  }
  
  if (req.files['music']) {
    const newMusic = req.files['music'].map(f => `/uploads/music/${f.filename}`);
    music = [...music, ...newMusic];
  }
  
  db.run(
    'UPDATE diaries SET title = ?, content = ?, date = ?, photos = ?, music = ? WHERE id = ?',
    [title, content, date, JSON.stringify(photos), JSON.stringify(music), req.params.id]
  );
  
  saveDB();
  res.json({ success: true });
});

// Delete diary (admin only)
app.delete('/api/diaries/:id', requireAuth, (req, res) => {
  const result = db.exec(`SELECT * FROM diaries WHERE id = ${req.params.id}`);
  
  if (result.length > 0 && result[0].values.length > 0) {
    // Delete associated files
    const photos = JSON.parse(result[0].values[0][3] || '[]');
    const music = JSON.parse(result[0].values[0][4] || '[]');
    
    [...photos, ...music].forEach(filePath => {
      const fullPath = path.join(__dirname, 'public', filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    });
    
    db.run(`DELETE FROM diaries WHERE id = ${req.params.id}`);
    saveDB();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Diary not found' });
  }
});

// Get all music
app.get('/api/music', (req, res) => {
  const result = db.exec("SELECT id, title, music FROM diaries WHERE music != '[]'");
  
  if (result.length === 0) {
    return res.json([]);
  }
  
  const allMusic = [];
  
  result[0].values.forEach(row => {
    const music = JSON.parse(row[2] || '[]');
    music.forEach(m => {
      allMusic.push({
        id: row[0],
        title: row[1],
        src: m
      });
    });
  });
  
  res.json(allMusic);
});

// Serve index.html for all non-API routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Neon Diary server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
