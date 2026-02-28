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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + Math.random().toString(36).slice(2) + path.extname(file.originalname))
});
const upload = multer({ storage });

// ── IN-MEMORY STORE ──────────────────────────────────────
let products = [];
let orders = [];
let users = [];
let admins = [
  { id: 'head_001', name: 'Head Admin', email: 'head@inminutes.in', password: 'head123', role: 'head', createdAt: new Date().toISOString() }
];
let orderCounter = 1001;

// ── PRODUCTS ─────────────────────────────────────────────
app.get('/products', (req, res) => res.json(products));

app.post('/products', upload.array('images', 5), (req, res) => {
  const data = JSON.parse(req.body.data);
  const images = (req.files || []).map(f => `http://localhost:4000/images/${f.filename}`);
  const p = { id: Date.now(), ...data, price: Number(data.price), qty: Number(data.qty), images, createdBy: data.createdBy || 'admin' };
  products.push(p);
  res.json(p);
});

app.put('/products/:id', upload.array('images', 5), (req, res) => {
  const data = JSON.parse(req.body.data);
  const newImgs = (req.files || []).map(f => `http://localhost:4000/images/${f.filename}`);
  products = products.map(p => p.id === Number(req.params.id)
    ? { ...p, ...data, price: Number(data.price), qty: Number(data.qty), images: [...(data.keepImages || []), ...newImgs] }
    : p);
  res.json({ success: true });
});

app.delete('/products/:id', (req, res) => {
  products = products.filter(p => p.id !== Number(req.params.id));
  res.json({ success: true });
});

// ── ADMINS (managed by head) ──────────────────────────────
app.get('/admins', (req, res) => res.json(admins.map(({ password: _, ...a }) => a)));

app.post('/admins', (req, res) => {
  const { name, email, password, role } = req.body;
  if (admins.find(a => a.email === email)) return res.status(400).json({ error: 'Email already exists' });
  const admin = { id: 'adm_' + Date.now(), name, email, password, role: role || 'admin', createdAt: new Date().toISOString() };
  admins.push(admin);
  const { password: _, ...safe } = admin;
  res.json(safe);
});

app.delete('/admins/:id', (req, res) => {
  if (req.params.id === 'head_001') return res.status(403).json({ error: 'Cannot delete head admin' });
  admins = admins.filter(a => a.id !== req.params.id);
  res.json({ success: true });
});

app.put('/admins/:id', (req, res) => {
  const { name, email, password } = req.body;
  admins = admins.map(a => a.id === req.params.id ? { ...a, name: name || a.name, email: email || a.email, password: password || a.password } : a);
  res.json({ success: true });
});

app.post('/admins/login', (req, res) => {
  const { email, password } = req.body;
  const admin = admins.find(a => a.email === email && a.password === password);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const { password: _, ...safe } = admin;
  res.json(safe);
});

// ── USERS ────────────────────────────────────────────────
app.get('/users', (req, res) => res.json(users.map(({ password: _, ...u }) => u)));

app.post('/users/register', (req, res) => {
  const { name, phone, email, password } = req.body;
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
  const user = { id: Date.now(), name, phone, email, password, addresses: [], createdAt: new Date().toISOString() };
  users.push(user);
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.post('/users/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.get('/users/:id', (req, res) => {
  const user = users.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.post('/users/:id/address', (req, res) => {
  const addr = { id: Date.now(), ...req.body };
  users = users.map(u => u.id === Number(req.params.id) ? { ...u, addresses: [...u.addresses, addr] } : u);
  const user = users.find(u => u.id === Number(req.params.id));
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.delete('/users/:id/address/:addrId', (req, res) => {
  users = users.map(u => u.id === Number(req.params.id)
    ? { ...u, addresses: u.addresses.filter(a => a.id !== Number(req.params.addrId)) }
    : u);
  res.json({ success: true });
});

// ── ORDERS ───────────────────────────────────────────────
app.get('/orders', (req, res) => res.json(orders));
app.get('/orders/user/:userId', (req, res) => res.json(orders.filter(o => o.userId === Number(req.params.userId))));

app.post('/orders', (req, res) => {
  const { userId, items, paymentMethod, address } = req.body;
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    if (!p) return res.status(400).json({ error: 'Product not found' });
    if (p.qty < item.quantity) return res.status(400).json({ error: `Only ${p.qty} units of "${p.name}" available` });
  }
  items.forEach(item => {
    products = products.map(p => p.id === item.productId ? { ...p, qty: p.qty - item.quantity, inStock: (p.qty - item.quantity) > 0 } : p);
  });
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const user = users.find(u => u.id === Number(userId));
  const order = {
    id: '#ORD-' + orderCounter++,
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
  orders.push(order);
  res.json(order);
});

app.put('/orders/:id/status', (req, res) => {
  orders = orders.map(o => o.id === req.params.id ? { ...o, status: req.body.status } : o);
  res.json({ success: true });
});

app.put('/orders/:id/seen', (req, res) => {
  orders = orders.map(o => o.id === req.params.id ? { ...o, isNew: false } : o);
  res.json({ success: true });
});

// ── STATS ────────────────────────────────────────────────
app.get('/stats', (req, res) => {
  const revenue = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.total, 0);
  res.json({ products: products.length, orders: orders.length, users: users.length, admins: admins.length - 1, revenue });
});

const PORT = 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅  In Minutes backend running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   Network: http://${net.address}:${PORT}`);
        console.log(`\n   Share this with your team: http://${net.address}:${PORT}`);
      }
    }
  }
});