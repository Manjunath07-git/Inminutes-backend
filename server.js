const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use('/images', express.static('uploads'));
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ── PERSISTENT FILE STORAGE ──────────────────────────────
const DB_FILE = 'db.json';

const defaultDB = {
  products: [],
  orders: [],
  users: [],
  admins: [
    { id: 'head_001', name: 'Head Admin', email: 'head@inminutes.in', password: 'head123', role: 'head', createdAt: new Date().toISOString() }
  ],
  orderCounter: 1001
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // Make sure all keys exist
      return { ...defaultDB, ...data };
    }
  } catch(e) { console.log('DB load error, using defaults:', e.message); }
  return { ...defaultDB };
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch(e) { console.log('DB save error:', e.message); }
}

let db = loadDB();

// Shortcuts
const getProducts = () => db.products;
const getOrders = () => db.orders;
const getUsers = () => db.users;
const getAdmins = () => db.admins;

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + Math.random().toString(36).slice(2) + path.extname(file.originalname))
});
const upload = multer({ storage: multerStorage });

// ── PRODUCTS ─────────────────────────────────────────────
app.get('/products', (req, res) => res.json(db.products));

app.post('/products', upload.array('images', 5), (req, res) => {
  const data = JSON.parse(req.body.data);
  const images = (req.files || []).map(f => `${req.protocol}://${req.get('host')}/images/${f.filename}`);
  const p = { id: Date.now(), ...data, price: Number(data.price), qty: Number(data.qty), images };
  db.products.push(p);
  saveDB();
  res.json(p);
});

app.put('/products/:id', upload.array('images', 5), (req, res) => {
  const data = JSON.parse(req.body.data);
  const newImgs = (req.files || []).map(f => `${req.protocol}://${req.get('host')}/images/${f.filename}`);
  db.products = db.products.map(p => p.id === Number(req.params.id)
    ? { ...p, ...data, price: Number(data.price), qty: Number(data.qty), images: [...(data.keepImages || []), ...newImgs] }
    : p);
  saveDB();
  res.json({ success: true });
});

app.delete('/products/:id', (req, res) => {
  db.products = db.products.filter(p => p.id !== Number(req.params.id));
  saveDB();
  res.json({ success: true });
});

// ── ADMINS ────────────────────────────────────────────────
app.get('/admins', (req, res) => res.json(db.admins.map(({ password: _, ...a }) => a)));

app.post('/admins', (req, res) => {
  const { name, email, password, role } = req.body;
  if (db.admins.find(a => a.email === email)) return res.status(400).json({ error: 'Email already exists' });
  const admin = { id: 'adm_' + Date.now(), name, email, password, role: role || 'admin', createdAt: new Date().toISOString() };
  db.admins.push(admin);
  saveDB();
  const { password: _, ...safe } = admin;
  res.json(safe);
});

app.delete('/admins/:id', (req, res) => {
  if (req.params.id === 'head_001') return res.status(403).json({ error: 'Cannot delete head admin' });
  db.admins = db.admins.filter(a => a.id !== req.params.id);
  saveDB();
  res.json({ success: true });
});

app.put('/admins/:id', (req, res) => {
  const { name, email, password } = req.body;
  db.admins = db.admins.map(a => a.id === req.params.id
    ? { ...a, name: name || a.name, email: email || a.email, password: password || a.password }
    : a);
  saveDB();
  res.json({ success: true });
});

app.post('/admins/login', (req, res) => {
  const { email, password } = req.body;
  const admin = db.admins.find(a => a.email === email && a.password === password);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const { password: _, ...safe } = admin;
  res.json(safe);
});

// ── USERS ─────────────────────────────────────────────────
app.get('/users', (req, res) => res.json(db.users.map(({ password: _, ...u }) => u)));

app.post('/users/register', (req, res) => {
  const { name, phone, email, password } = req.body;
  if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
  const user = { id: Date.now(), name, phone, email, password, addresses: [], createdAt: new Date().toISOString() };
  db.users.push(user);
  saveDB();
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.post('/users/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.get('/users/:id', (req, res) => {
  const user = db.users.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.post('/users/:id/address', (req, res) => {
  const addr = { id: Date.now(), ...req.body };
  db.users = db.users.map(u => u.id === Number(req.params.id) ? { ...u, addresses: [...u.addresses, addr] } : u);
  saveDB();
  const user = db.users.find(u => u.id === Number(req.params.id));
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.delete('/users/:id/address/:addrId', (req, res) => {
  db.users = db.users.map(u => u.id === Number(req.params.id)
    ? { ...u, addresses: u.addresses.filter(a => a.id !== Number(req.params.addrId)) }
    : u);
  saveDB();
  res.json({ success: true });
});

// ── ORDERS ────────────────────────────────────────────────
app.get('/orders', (req, res) => res.json(db.orders));
app.get('/orders/user/:userId', (req, res) => res.json(db.orders.filter(o => o.userId === Number(req.params.userId))));

app.post('/orders', (req, res) => {
  const { userId, items, paymentMethod, address } = req.body;
  for (const item of items) {
    const p = db.products.find(p => p.id === item.productId);
    if (!p) return res.status(400).json({ error: 'Product not found' });
    if (p.qty < item.quantity) return res.status(400).json({ error: `Only ${p.qty} units of "${p.name}" available` });
  }
  items.forEach(item => {
    db.products = db.products.map(p => p.id === item.productId
      ? { ...p, qty: p.qty - item.quantity, inStock: (p.qty - item.quantity) > 0 }
      : p);
  });
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const user = db.users.find(u => u.id === Number(userId));
  const order = {
    id: '#ORD-' + db.orderCounter++,
    userId: Number(userId),
    userName: user?.name || 'Unknown',
    userPhone: user?.phone || '',
    userEmail: user?.email || '',
    items, subtotal,
    deliveryFee: 25,
    total: subtotal + 25,
    paymentMethod, address,
    status: 'Confirmed',
    createdAt: new Date().toISOString(),
    isNew: true
  };
  db.orders.push(order);
  saveDB();
  res.json(order);
});

app.put('/orders/:id/status', (req, res) => {
  db.orders = db.orders.map(o => o.id === req.params.id ? { ...o, status: req.body.status } : o);
  saveDB();
  res.json({ success: true });
});

app.put('/orders/:id/seen', (req, res) => {
  db.orders = db.orders.map(o => o.id === req.params.id ? { ...o, isNew: false } : o);
  saveDB();
  res.json({ success: true });
});

// ── STATS ─────────────────────────────────────────────────
app.get('/stats', (req, res) => {
  const revenue = db.orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.total, 0);
  res.json({ products: db.products.length, orders: db.orders.length, users: db.users.length, admins: db.admins.length - 1, revenue });
});

// ── KEEP ALIVE (prevents Render from sleeping) ────────────
app.get('/ping', (req, res) => res.json({ status: 'alive', time: new Date().toISOString() }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅  In Minutes backend running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   Network: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`\n   Data saved to: ${DB_FILE}`);
  console.log(`   Products: ${db.products.length} | Orders: ${db.orders.length} | Users: ${db.users.length}`);
});
