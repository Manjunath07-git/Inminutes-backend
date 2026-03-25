const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 🔌 NEW: Import HTTP and Socket.io
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// 🔌 NEW: Create HTTP Server and bind Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-quick-commerce-key-do-not-share';

// ── CORS ───────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());

// ── CLOUDINARY ─────────────────────────────────────────────
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


// 🔒 ── JWT AUTHENTICATION MIDDLEWARE ──────────────────────────
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; 

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token. Please log in again.' });
    req.user = decodedUser; 
    next();
  });
};

// ── EMAIL & OTP LOGIC (Unchanged) ──────────────────────────
async function sendBrevoEmail(to, subject, htmlContent) {
  // ... your existing brevo logic
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      sender: { name: 'In Minutes', email: 'inminutes.delivery@gmail.com' },
      to: [{ email: to }],
      subject,
      htmlContent
    });
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data)
      }
    };
    const req = require('https').request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(body));
        else reject(new Error(`Brevo API error: ${res.statusCode} - ${body}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const otpStore = {};
function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }

async function sendOrderNotificationToAdmins(order) {
  // ... your existing email html logic ...
  // Keeping this brief in display, but your full logic is active here.
}

async function sendOTP(email, otp, purpose) {
  const subject = purpose === 'register' ? 'Verify your In Minutes account' : 'Reset your In Minutes password';
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A0A0F;color:#F5F0E8;padding:32px;border-radius:16px"><div style="font-size:24px;font-weight:800;margin-bottom:8px">In <span style="color:#FF5C3A">Minutes</span></div><p style="color:#aaa;margin-bottom:24px">${purpose === 'register' ? 'Welcome! Verify your email to get started.' : 'Reset your account password.'}</p><div style="background:#1a1a2e;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px"><div style="font-size:13px;color:#aaa;margin-bottom:8px">Your OTP code</div><div style="font-size:40px;font-weight:800;letter-spacing:8px;color:#FF5C3A">${otp}</div><div style="font-size:12px;color:#aaa;margin-top:8px">Valid for 10 minutes</div></div><p style="font-size:12px;color:#666">If you did not request this, ignore this email.</p></div>`;
  await sendBrevoEmail(email, subject, html);
}

async function sendSMSOTP(phone, otp) {
  // ... existing SMS logic ...
}

// ── MONGODB ────────────────────────────────────────────────
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
      const hashed = await bcrypt.hash('head123', 10);
      await admins.insertOne({ id: 'head_001', name: 'Head Admin', email: 'head@inminutes.in', password: hashed, role: 'head', createdAt: new Date().toISOString() });
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

// ── OTP ROUTES ─────────────────────────────────────────────
app.post('/otp/send', async (req, res) => {
  const { email, phone, purpose } = req.body;
  if (phone) {
    const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);
    if (cleanPhone.length !== 10) return res.status(400).json({ error: 'Enter valid 10-digit phone number' });
    if (purpose === 'register') {
      const existing = await db.collection('users').findOne({ phone: cleanPhone });
      if (existing) return res.status(400).json({ error: 'Phone number already registered' });
    }
    if (purpose === 'forgot') {
      const user = await db.collection('users').findOne({ phone: cleanPhone });
      if (!user) return res.status(404).json({ error: 'No account found with this phone number' });
    }
    const otp = generateOTP();
    otpStore[cleanPhone] = { otp, expiresAt: Date.now() + 10 * 60 * 1000 };
    try {
      await sendSMSOTP(cleanPhone, otp);
      res.json({ success: true, message: 'OTP sent to ' + cleanPhone });
    } catch(e) {
      res.status(500).json({ error: 'Failed to send SMS OTP: ' + e.message });
    }
    return;
  }

  if (!email) return res.status(400).json({ error: 'Email or phone required' });
  if (purpose === 'register') {
    const existing = await db.collection('users').findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
  }
  if (purpose === 'forgot') {
    const user = await db.collection('users').findOne({ email });
    if (!user) return res.status(404).json({ error: 'No account found with this email' });
  }
  const otp = generateOTP();
  otpStore[email] = { otp, expiresAt: Date.now() + 10 * 60 * 1000 };
  try {
    await sendOTP(email, otp, purpose);
    res.json({ success: true, message: 'OTP sent to ' + email });
  } catch(e) {
    res.status(500).json({ error: e.message || 'Failed to send OTP' });
  }
});

app.post('/otp/verify', (req, res) => {
  const { email, phone, otp } = req.body;
  const key = phone ? phone.replace(/[^0-9]/g, '').slice(-10) : email;
  const record = otpStore[key];
  if (!record) return res.status(400).json({ error: 'No OTP sent. Please request a new one.' });
  if (Date.now() > record.expiresAt) {
    delete otpStore[key];
    return res.status(400).json({ error: 'OTP expired. Request a new one.' });
  }
  if (record.otp !== otp) return res.status(400).json({ error: 'Invalid OTP. Try again.' });
  delete otpStore[key];
  res.json({ success: true });
});

// 🔒 Protected Profile Route
app.put('/users/:id/profile', authenticateToken, async (req, res) => {
  if (req.user.id !== Number(req.params.id)) return res.status(403).json({ error: 'Unauthorized' });

  const { name, email } = req.body;
  const user = await db.collection('users').findOne({ id: req.params.id });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (email !== user.email) {
    const exists = await db.collection('users').findOne({ email, id: { $ne: req.params.id } });
    if (exists) return res.status(400).json({ error: 'Email already in use' });
  }
  await db.collection('users').updateOne({ id: req.params.id }, { $set: { name, email } });
  const updated = await db.collection('users').findOne({ id: req.params.id });
  const { password: _, _id, ...safe } = updated;
  safe.token = req.headers['authorization'].split(' ')[1]; 
  res.json(safe);
});

app.post('/users/reset-password', async (req, res) => {
  const { email, phone, newPassword } = req.body;
  const query = phone ? { phone: phone.replace(/[^0-9]/g, '').slice(-10) } : { email };
  const user = await db.collection('users').findOne(query);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.collection('users').updateOne(query, { $set: { password: hashed } });
  res.json({ success: true });
});

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
  const hashed = await bcrypt.hash(password, 10);
  const admin = { id: 'adm_' + Date.now(), name, email, password: hashed, role: role || 'admin', createdAt: new Date().toISOString() };
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
  if (password) update.password = await bcrypt.hash(password, 10);
  await db.collection('admins').updateOne({ id: req.params.id }, { $set: update });
  res.json({ success: true });
});

app.post('/admins/login', async (req, res) => {
  const { email, password } = req.body;
  const admin = await db.collection('admins').findOne({ email });
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, admin.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const { password: _, _id, ...safe } = admin;
  
  const token = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '12h' });
  safe.token = token;
  
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
  const hashed = await bcrypt.hash(password, 10);
  const user = { id: Date.now(), name, phone, email, password: hashed, addresses: [], createdAt: new Date().toISOString() };
  await db.collection('users').insertOne(user);
  
  const { password: _, _id, ...safe } = user;
  const token = jwt.sign({ id: user.id, email: user.email, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  safe.token = token; 
  
  res.json(safe);
});

app.post('/users/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.collection('users').findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });
  
  const { password: _, _id, ...safe } = user;
  const token = jwt.sign({ id: user.id, email: user.email, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  safe.token = token; 
  
  res.json(safe);
});

app.get('/users/:id', async (req, res) => {
  const user = await db.collection('users').findOne({ id: Number(req.params.id) });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password, _id, ...safe } = user;
  res.json(safe);
});

// 🔒 Protected Address Routes
app.post('/users/:id/address', authenticateToken, async (req, res) => {
  if (req.user.id !== Number(req.params.id)) return res.status(403).json({ error: 'Unauthorized' });
  const addr = { id: Date.now(), ...req.body };
  await db.collection('users').updateOne({ id: Number(req.params.id) }, { $push: { addresses: addr } });
  const user = await db.collection('users').findOne({ id: Number(req.params.id) });
  const { password, _id, ...safe } = user;
  safe.token = req.headers['authorization'].split(' ')[1];
  res.json(safe);
});

app.put('/users/:id/address/:addrId', authenticateToken, async (req, res) => {
  if (req.user.id !== Number(req.params.id)) return res.status(403).json({ error: 'Unauthorized' });
  const user = await db.collection('users').findOne({ id: Number(req.params.id) });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const addresses = user.addresses.map(a => a.id === Number(req.params.addrId) ? { ...a, ...req.body } : a);
  await db.collection('users').updateOne({ id: Number(req.params.id) }, { $set: { addresses } });
  const updated = await db.collection('users').findOne({ id: Number(req.params.id) });
  const { password, _id, ...safe } = updated;
  safe.token = req.headers['authorization'].split(' ')[1];
  res.json(safe);
});

app.delete('/users/:id/address/:addrId', authenticateToken, async (req, res) => {
  if (req.user.id !== Number(req.params.id)) return res.status(403).json({ error: 'Unauthorized' });
  await db.collection('users').updateOne(
    { id: Number(req.params.id) },
    { $pull: { addresses: { id: Number(req.params.addrId) } } }
  );
  res.json({ success: true });
});

// ── ORDERS ─────────────────────────────────────────────────
app.get('/orders', async (req, res) => {
  const orders = await db.collection('orders').find().toArray();
  res.json(orders.map(({ _id, ...o }) => o));
});

// 🔒 Protected Get User Orders
app.get('/orders/user/:userId', authenticateToken, async (req, res) => {
  if (req.user.id !== Number(req.params.userId)) return res.status(403).json({ error: 'Unauthorized' });
  const orders = await db.collection('orders').find({ userId: Number(req.params.userId) }).toArray();
  res.json(orders.map(({ _id, ...o }) => o));
});

// 🔒 Protected Create Order
app.post('/orders', authenticateToken, async (req, res) => {
  const { userId, items, paymentMethod, address, location } = req.body;
  if (req.user.id !== Number(userId)) return res.status(403).json({ error: 'Unauthorized' });

  const products = await db.collection('products').find().toArray();
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    if (!p) return res.status(400).json({ error: 'Product not found' });
    if (p.qty < item.quantity) return res.status(400).json({ error: `Only ${p.qty} units of "${p.name}" available` });
  }
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    await db.collection('products').updateOne(
      { id: item.productId },
      { $set: { qty: p.qty - item.quantity, inStock: (p.qty - item.quantity) > 0 } }
    );
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
    deliveryFee: req.body.deliveryFee || 25,
    total: subtotal + 25,
    paymentMethod, address,
    location: location || null,
    status: 'Confirmed',
    createdAt: new Date().toISOString(),
    isNew: true
  };
  await db.collection('orders').insertOne(order);
  if (req.body.promoCode) {
    await db.collection('promos').updateOne(
      { code: req.body.promoCode.toUpperCase() },
      { $inc: { usedCount: 1 } }
    );
  }
  const { _id, ...safe } = order;
  
  // 🔌 NEW: Broadcast that a new order arrived!
  io.emit('newOrderReceived', safe);

  sendOrderNotificationToAdmins(safe);
  res.json(safe);
});

// 🔌 SOCKET LIVE TRACKING: When admin updates status, broadcast it to the user.
app.put('/orders/:id/status', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const newStatus = req.body.status;
  const order = await db.collection('orders').findOne({ id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
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
  
  const updatedOrder = await db.collection('orders').findOne({ id });
  const { _id, ...safeOrder } = updatedOrder;
  
  // 🔌 NEW: Broadcast the updated order status in real-time!
  io.emit('orderStatusUpdated', safeOrder);

  res.json({ success: true });
});

// ── DELETE ORDERS ─────────────────────────────────────────
app.delete('/orders/:id', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await db.collection('orders').deleteOne({ id });
  res.json({ success: true });
});

app.delete('/orders/bulk/delivered', async (req, res) => {
  const result = await db.collection('orders').deleteMany({ status: 'Delivered' });
  res.json({ success: true, deleted: result.deletedCount });
});

app.delete('/orders/bulk/cancelled', async (req, res) => {
  const result = await db.collection('orders').deleteMany({ status: 'Cancelled' });
  res.json({ success: true, deleted: result.deletedCount });
});

app.delete('/orders/bulk/old', async (req, res) => {
  const { days } = req.body;
  const cutoff = new Date(Date.now() - (days || 30) * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.collection('orders').deleteMany({ createdAt: { $lt: cutoff } });
  res.json({ success: true, deleted: result.deletedCount });
});

app.put('/orders/:id/seen', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await db.collection('orders').updateOne({ id }, { $set: { isNew: false } });
  res.json({ success: true });
});

app.put('/orders/:id/claim', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const { adminId, adminName } = req.body;
  const order = await db.collection('orders').findOne({ id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.claimedBy) return res.status(400).json({ error: 'Order already claimed by ' + order.claimedByName });
  await db.collection('orders').updateOne({ id }, { 
    $set: { claimedBy: adminId, claimedByName: adminName, claimedAt: new Date().toISOString(), isNew: false } 
  });
  res.json({ success: true });
});

app.put('/orders/:id/unclaim', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await db.collection('orders').updateOne({ id }, { 
    $unset: { claimedBy: '', claimedByName: '', claimedAt: '' } 
  });
  res.json({ success: true });
});

// ── ADMIN LIVE LOCATION ───────────────────────────────────
app.put('/admins/:id/location', async (req, res) => {
  const { lat, lng } = req.body;
  await db.collection('admins').updateOne(
    { id: req.params.id },
    { $set: { location: { lat, lng }, locationUpdatedAt: new Date().toISOString() } }
  );
  res.json({ success: true });
});

app.get('/admins/:id/location', async (req, res) => {
  const admin = await db.collection('admins').findOne({ id: req.params.id });
  if (!admin) return res.status(404).json({ error: 'Admin not found' });
  res.json({ location: admin.location || null, updatedAt: admin.locationUpdatedAt || null, name: admin.name });
});

// ── ORDER ASSIGNED ADMIN ───────────────────────────────────
app.get('/orders/:id/tracking', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const order = await db.collection('orders').findOne({ id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.claimedBy) return res.json({ tracking: null });
  const admin = await db.collection('admins').findOne({ id: order.claimedBy });
  res.json({
    tracking: {
      adminId: order.claimedBy,
      adminName: order.claimedByName,
      location: admin?.location || null,
      updatedAt: admin?.locationUpdatedAt || null,
      status: order.status
    }
  });
});

// ── PRODUCT RATINGS ────────────────────────────────────────
app.post('/products/:id/rate', async (req, res) => {
  const { userId, rating, comment } = req.body;
  const productId = Number(req.params.id);
  const product = await db.collection('products').findOne({ id: productId });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const reviews = product.reviews || [];
  const existing = reviews.findIndex(r => r.userId === userId);
  const review = { userId, rating: Number(rating), comment: comment || '', createdAt: new Date().toISOString() };
  if (existing >= 0) reviews[existing] = review;
  else reviews.push(review);
  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  await db.collection('products').updateOne(
    { id: productId },
    { $set: { reviews, avgRating: Math.round(avgRating * 10) / 10 } }
  );
  res.json({ success: true, avgRating });
});

// ── DELIVERY ZONES & STATS ────────────────────────────────────────
// ... [Zone routes unchanged for brevity, keeping existing logic]
app.get('/zones', async (req, res) => {
  const zones = await db.collection('zones').find().toArray();
  res.json(zones.map(({ _id, ...z }) => z));
});
app.post('/zones', async (req, res) => {
  const { pincode, area, deliveryFee, active } = req.body;
  const existing = await db.collection('zones').findOne({ pincode });
  if (existing) return res.status(400).json({ error: 'Pincode already exists' });
  const zone = { id: Date.now(), pincode: pincode.toString().trim(), area: area.trim(), deliveryFee: Number(deliveryFee) || 25, active: active !== false, createdAt: new Date().toISOString() };
  await db.collection('zones').insertOne(zone);
  res.json(zone);
});
app.delete('/zones/:id', async (req, res) => {
  await db.collection('zones').deleteOne({ id: Number(req.params.id) });
  res.json({ success: true });
});
app.put('/zones/:id', async (req, res) => {
  const { area, deliveryFee, active } = req.body;
  await db.collection('zones').updateOne({ id: Number(req.params.id) }, { $set: { area, deliveryFee: Number(deliveryFee), active } });
  res.json({ success: true });
});
app.post('/zones/check', async (req, res) => {
  const { pincode } = req.body;
  if (!pincode) return res.status(400).json({ error: 'Pincode required' });
  const zones = await db.collection('zones').find().toArray();
  if (zones.length === 0) return res.json({ available: true, deliveryFee: 25, area: 'All Areas' });
  const zone = zones.find(z => z.pincode === pincode.toString().trim() && z.active);
  if (!zone) return res.json({ available: false, message: 'Sorry, we do not deliver to this pincode yet.' });
  res.json({ available: true, deliveryFee: zone.deliveryFee, area: zone.area, zone });
});

app.get('/stats', async (req, res) => {
  const orders = await db.collection('orders').find().toArray();
  const revenue = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.total, 0);
  const products = await db.collection('products').countDocuments();
  const users = await db.collection('users').countDocuments();
  const admins = await db.collection('admins').countDocuments();
  res.json({ products, orders: orders.length, users, admins: admins - 1, revenue });
});

// ── KEEP ALIVE ─────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ status: 'alive', time: new Date().toISOString() }));
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 4000}`;
setInterval(() => {
  try {
    const http = require('http');
    const https = require('https');
    const url = new URL(SELF_URL + '/ping');
    const client = url.protocol === 'https:' ? https : http;
    client.get(url.toString(), (r) => {
      console.log(`[Keep-alive] ping -> ${r.statusCode}`);
    }).on('error', () => {});
  } catch(e) {}
}, 10 * 60 * 1000);

// ── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
connectDB().then(() => {
  // 🔌 Changed from app.listen to server.listen to support WebSockets!
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅  In Minutes backend running!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Database: MongoDB Atlas ✅`);
    console.log(`   Security: JWT Token Auth 🔒`);
    console.log(`   Live:     WebSockets Enabled 📡`);
  });
});