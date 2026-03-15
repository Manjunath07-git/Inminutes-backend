const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// Strong CORS fix for mobile browsers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'false');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','Origin','Accept'] }));
app.use(express.json());

// ── CLOUDINARY CONFIG ──────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dreykfxfp',
  api_key: process.env.CLOUDINARY_API_KEY || '486984161796895',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'jO3xmCTC7wxTXFTEhihJyxpwHY4'
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'inminutes', allowed_formats: ['jpg','jpeg','png','webp'] }
});
const upload = multer({ storage });

// ── MONGODB CONNECTION ─────────────────────────────────────
const MONGO_URL = process.env.MONGO_URL || 'mongodb+srv://inminutes:inminutes123@cluster0.iaf2563.mongodb.net/inminutes?appName=Cluster0';
let db;

async function connectDB() {
  try {
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db('inminutes');
    console.log('✅ MongoDB connected!');
    const admins = db.collection('admins');
    const head = await admins.findOne({ email: 'head@inminutes.in' });
    if (!head) {
      await admins.insertOne({ id: 'head_001', name: 'Head Admin', email: 'head@inminutes.in', password: 'head123', role: 'head', createdAt: new Date().toISOString() });
      console.log('✅ Head admin created');
    }
    const counters = db.collection('counters');
    const counter = await counters.findOne({ _id: 'orderCounter' });
    if (!counter) await counters.insertOne({ _id: 'orderCounter', value: 1001 });
  } catch(e) {
    console.error('❌ MongoDB connection failed:', e.message);
    process.exit(1);
  }
}

// ── PRODUCTS ───────────────────────────────────────────────
app.get('/products', async (req, res) => {
  const products = await db.collection('products').find().toArray();
  res.json(products);
});

app.post('/products', upload.array('images', 5), async (req, res) => {
  const data = JSON.parse(req.body.data);
  const images = (req.files || []).map(f => f.path);
  const p = { id: Date.now(), ...data, price: Number(data.price), qty: Number(data.qty), images };
  await db.collection('products').insertOne(p);
  res.json(p);
});

app.put('/products/:id', upload.array('images', 5), async (req, res) => {
  const data = JSON.parse(req.body.data);
  const newImgs = (req.files || []).map(f => f.path);
  await db.collection('products').updateOne(
    { id: Number(req.params.id) },
    { $set: { ...data, price: Number(data.price), qty: Number(data.qty), images: [...(data.keepImages || []), ...newImgs] } }
  );
  res.json({ success: true });
});

app.delete('/products/:id', async (req, res) => {
  await db.collection('products').deleteOne({ id: Number(req.params.id) });
  res.json({ success: true });
});

// ── ADMINS ─────────────────────────────────────────────────
app.get('/admins', async (req, res) => {
  const admins = await db.collection('admins').find().toArray();
  res.json(admins.map(({ password, _id, ...a }) => a));
});

app.post('/admins', async (req, res) => {
  const { name, email, password, role } = req.body;
  const existing = await db.collection('admins').findOne({ email });
  if (existing) return res.status(400).json({ error: 'Email already exists' });
  const admin = { id: 'adm_' + Date.now(), name, email, password, role: role || 'admin', createdAt: new Date().toISOString() };
  await db.collection('admins').insertOne(admin);
  const { password: _, _id, ...safe } = admin;
  res.json(safe);
});

app.delete('/admins/:id', async (req, res) => {
  if (req.params.id === 'head_001') return res.status(403).json({ error: 'Cannot delete head admin' });
  await db.collection('admins').deleteOne({ id: req.params.id });
  res.json({ success: true });
});

app.put('/admins/:id', async (req, res) => {
  const { name, email, password } = req.body;
  const update = {};
  if (name) update.name = name;
  if (email) update.email = email;
  if (password) update.password = password;
  await db.collection('admins').updateOne({ id: req.params.id }, { $set: update });
  res.json({ success: true });
});

app.post('/admins/login', async (req, res) => {
  const { email, password } = req.body;
  const admin = await db.collection('admins').findOne({ email, password });
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const { password: _, _id, ...safe } = admin;
  res.json(safe);
});

// ── USERS ──────────────────────────────────────────────────
app.get('/users', async (req, res) => {
  const users = await db.collection('users').find().toArray();
  res.json(users.map(({ password, _id, ...u }) => u));
});

app.post('/users/register', async (req, res) => {
  const { name, phone, email, password } = req.body;
  const existing = await db.collection('users').findOne({ email });
  if (existing) return res.status(400).json({ error: 'Email already registered' });
  const user = { id: Date.now(), name, phone, email, password, addresses: [], createdAt: new Date().toISOString() };
  await db.collection('users').insertOne(user);
  const { password: _, _id, ...safe } = user;
  res.json(safe);
});

app.post('/users/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.collection('users').findOne({ email, password });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const { password: _, _id, ...safe } = user;
  res.json(safe);
});

app.get('/users/:id', async (req, res) => {
  const user = await db.collection('users').findOne({ id: Number(req.params.id) });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password, _id, ...safe } = user;
  res.json(safe);
});

app.post('/users/:id/address', async (req, res) => {
  const addr = { id: Date.now(), ...req.body };
  await db.collection('users').updateOne({ id: Number(req.params.id) }, { $push: { addresses: addr } });
  const user = await db.collection('users').findOne({ id: Number(req.params.id) });
  const { password, _id, ...safe } = user;
  res.json(safe);
});

app.put('/users/:id/address/:addrId', async (req, res) => {
  const user = await db.collection('users').findOne({ id: Number(req.params.id) });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const addresses = user.addresses.map(a => a.id === Number(req.params.addrId) ? { ...a, ...req.body } : a);
  await db.collection('users').updateOne({ id: Number(req.params.id) }, { $set: { addresses } });
  const updated = await db.collection('users').findOne({ id: Number(req.params.id) });
  const { password, _id, ...safe } = updated;
  res.json(safe);
});

app.delete('/users/:id/address/:addrId', async (req, res) => {
  await db.collection('users').updateOne({ id: Number(req.params.id) }, { $pull: { addresses: { id: Number(req.params.addrId) } } });
  res.json({ success: true });
});

// ── ORDERS ─────────────────────────────────────────────────
app.get('/orders', async (req, res) => {
  const orders = await db.collection('orders').find().toArray();
  res.json(orders.map(({ _id, ...o }) => o));
});

app.get('/orders/user/:userId', async (req, res) => {
  const orders = await db.collection('orders').find({ userId: Number(req.params.userId) }).toArray();
  res.json(orders.map(({ _id, ...o }) => o));
});

app.post('/orders', async (req, res) => {
  const { userId, items, paymentMethod, address, location } = req.body;
  const products = await db.collection('products').find().toArray();
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    if (!p) return res.status(400).json({ error: 'Product not found' });
    if (p.qty < item.quantity) return res.status(400).json({ error: `Only ${p.qty} units of "${p.name}" available` });
  }
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    await db.collection('products').updateOne({ id: item.productId }, { $set: { qty: p.qty - item.quantity, inStock: (p.qty - item.quantity) > 0 } });
  }
  const counter = await db.collection('counters').findOneAndUpdate(
    { _id: 'orderCounter' }, { $inc: { value: 1 } }, { returnDocument: 'before' }
  );
  const orderNum = counter.value;
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const user = await db.collection('users').findOne({ id: Number(userId) });
  const order = {
    id: 'ORD-' + orderNum,
    userId: Number(userId),
    userName: user?.name || 'Unknown',
    userPhone: user?.phone || '',
    userEmail: user?.email || '',
    items, subtotal,
    deliveryFee: 25,
    total: subtotal + 25,
    paymentMethod, address,
    location: location || null,
    status: 'Confirmed',
    createdAt: new Date().toISOString(),
    isNew: true
  };
  await db.collection('orders').insertOne(order);
  const { _id, ...safe } = order;
  res.json(safe);
});

app.put('/orders/:id/status', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const newStatus = req.body.status;
  const order = await db.collection('orders').findOne({ id });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Restore stock if cancelling
  if (newStatus === 'Cancelled' && order.status !== 'Cancelled') {
    for (const item of order.items) {
      const product = await db.collection('products').findOne({ id: item.productId });
      if (product) {
        const newQty = (product.qty || 0) + item.quantity;
        await db.collection('products').updateOne(
          { id: item.productId },
          { $set: { qty: newQty, inStock: newQty > 0 } }
        );
      }
    }
  }

  await db.collection('orders').updateOne({ id }, { $set: { status: newStatus } });
  res.json({ success: true });
});

app.put('/orders/:id/seen', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await db.collection('orders').updateOne({ id }, { $set: { isNew: false } });
  res.json({ success: true });
});

// ── STATS ──────────────────────────────────────────────────
app.get('/stats', async (req, res) => {
  const orders = await db.collection('orders').find().toArray();
  const revenue = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.total, 0);
  const products = await db.collection('products').countDocuments();
  const users = await db.collection('users').countDocuments();
  const admins = await db.collection('admins').countDocuments();
  res.json({ products, orders: orders.length, users, admins: admins - 1, revenue });
});

// ── PING ───────────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ status: 'alive', time: new Date().toISOString() }));

// ── KEEP ALIVE ─────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 4000}`;
setInterval(() => {
  const http = require('http');
  const https = require('https');
  try {
    const url = new URL(SELF_URL + '/ping');
    const client = url.protocol === 'https:' ? https : http;
    client.get(url.toString(), (r) => { console.log(`[Keep-alive] ping → ${r.statusCode}`); }).on('error', () => {});
  } catch(e) {}
}, 10 * 60 * 1000);

// ── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅  In Minutes backend running!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) console.log(`   Network: http://${net.address}:${PORT}`);
      }
    }
    console.log(`\n   Database: MongoDB Atlas ✅`);
    console.log(`   Images:   Cloudinary ✅`);
  });
});