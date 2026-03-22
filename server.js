const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');


const app = express();

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

// ── EMAIL ──────────────────────────────────────────────────
// Brevo HTTP API (works on Render - no SMTP needed)
async function sendBrevoEmail(to, subject, htmlContent) {
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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Brevo API error: ${res.statusCode} - ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const otpStore = {};

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOrderNotificationToAdmins(order) {
  try {
    const admins = await db.collection('admins').find({ role: 'admin' }).toArray();
    const adminEmails = admins.map(a => a.email).filter(Boolean);
    if (!adminEmails.length) return;

    const itemsList = order.items.map(i => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">Rs.${i.price * i.quantity}</td>
    </tr>`).join('');

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;background:#fff;border:1px solid #eee;border-radius:12px;overflow:hidden">
        <div style="background:#1DBF73;padding:20px 24px">
          <div style="font-size:22px;font-weight:800;color:#fff">In Minutes</div>
          <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px">New Order Received!</div>
        </div>
        <div style="padding:24px">
          <div style="background:#F0FBF4;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-size:13px;color:#888;margin-bottom:4px">Order ID</div>
            <div style="font-size:20px;font-weight:800;color:#1DBF73">${order.id}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
            <tr style="background:#f9f9f9">
              <th style="padding:8px;text-align:left;font-size:12px;color:#888">ITEM</th>
              <th style="padding:8px;text-align:center;font-size:12px;color:#888">QTY</th>
              <th style="padding:8px;text-align:right;font-size:12px;color:#888">AMOUNT</th>
            </tr>
            ${itemsList}
            <tr>
              <td colspan="2" style="padding:10px 8px;font-weight:700;font-size:14px">Total</td>
              <td style="padding:10px 8px;font-weight:800;font-size:16px;text-align:right;color:#1DBF73">Rs.${order.total}</td>
            </tr>
          </table>
          <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-size:12px;color:#888;margin-bottom:8px;font-weight:700;text-transform:uppercase">Customer Details</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Name:</strong> ${order.userName}</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Phone:</strong> ${order.userPhone}</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Email:</strong> ${order.userEmail}</div>
            <div style="font-size:13px;color:#333"><strong>Address:</strong> ${order.address?.line1 || ''}, ${order.address?.city || ''} - ${order.address?.pincode || ''}</div>
          </div>
          <div style="background:#f9f9f9;border-radius:8px;padding:16px">
            <div style="font-size:12px;color:#888;margin-bottom:8px;font-weight:700;text-transform:uppercase">Order Details</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Payment:</strong> ${order.paymentMethod?.toUpperCase()}</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Subtotal:</strong> Rs.${order.subtotal}</div>
            <div style="font-size:13px;color:#333"><strong>Delivery Fee:</strong> Rs.${order.deliveryFee}</div>
          </div>
          <div style="margin-top:20px;text-align:center">
            <div style="font-size:12px;color:#aaa">Please login to admin panel to update order status</div>
          </div>
        </div>
      </div>
    `;

    for (const adminEmail of adminEmails) {
      await sendBrevoEmail(adminEmail, `New Order ${order.id} - Rs.${order.total} from ${order.userName}`, html);
    }
    console.log(`Order notification sent to: ${adminEmails.join(', ')}`);
  } catch(e) {
    console.error('Order notification email error:', e.message);
  }
}

async function sendOTP(email, otp, purpose) {
  const subject = purpose === 'register' ? 'Verify your In Minutes account' : 'Reset your In Minutes password';
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A0A0F;color:#F5F0E8;padding:32px;border-radius:16px"><div style="font-size:24px;font-weight:800;margin-bottom:8px">In <span style="color:#FF5C3A">Minutes</span></div><p style="color:#aaa;margin-bottom:24px">${purpose === 'register' ? 'Welcome! Verify your email to get started.' : 'Reset your account password.'}</p><div style="background:#1a1a2e;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px"><div style="font-size:13px;color:#aaa;margin-bottom:8px">Your OTP code</div><div style="font-size:40px;font-weight:800;letter-spacing:8px;color:#FF5C3A">${otp}</div><div style="font-size:12px;color:#aaa;margin-top:8px">Valid for 10 minutes</div></div><p style="font-size:12px;color:#666">If you did not request this, ignore this email.</p></div>`;
  await sendBrevoEmail(email, subject, html);
}

async function sendSMSOTP(phone, otp) {
  // Using 2Factor.in - free Indian SMS OTP service
  const TWOFACTOR_KEY = process.env.TWOFACTOR_KEY || '';
  const message = `Your In Minutes OTP is ${otp}. Valid for 10 minutes. Do not share with anyone.`;

  // Try 2Factor if key exists
  if (TWOFACTOR_KEY) {
    const https = require('https');
    const url = `https://2factor.in/API/V1/${TWOFACTOR_KEY}/SMS/${phone}/${otp}/OTP1`;
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            console.log('2Factor response:', parsed);
            if (parsed.Status === 'Success') resolve(parsed);
            else reject(new Error(parsed.Details || 'SMS failed'));
          } catch(e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  // Fallback: Textbelt free (1 SMS/day for testing)
  const https = require('https');
  const querystring = require('querystring');
  const postData = querystring.stringify({
    phone: '+91' + phone,
    message: message,
    key: 'textbelt'
  });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'textbelt.com',
      port: 443,
      path: '/text',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log('Textbelt response:', parsed);
          if (parsed.success) resolve(parsed);
          else reject(new Error(parsed.error || 'SMS failed'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
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
    } else if (!head.password.startsWith('$2')) {
      const hashed = await bcrypt.hash(head.password, 10);
      await admins.updateOne({ email: 'head@inminutes.in' }, { $set: { password: hashed } });
      console.log('✅ Head admin password migrated to bcrypt');
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

  // Phone OTP
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
      console.error('SMS error:', e.message);
      res.status(500).json({ error: 'Failed to send SMS OTP: ' + e.message });
    }
    return;
  }

  // Email OTP
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
    console.error('Email error FULL:', JSON.stringify({
      message: e.message,
      code: e.code,
      command: e.command,
      response: e.response,
      responseCode: e.responseCode,
      brevo_user: process.env.BREVO_USER ? 'SET' : 'NOT SET',
      brevo_pass: process.env.BREVO_PASS ? 'SET' : 'NOT SET',
    }));
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

app.put('/users/:id/profile', async (req, res) => {
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
  res.json(safe);
});

app.post('/users/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.collection('users').findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });
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
  // Update promo usage if applied
  if (req.body.promoCode) {
    await db.collection('promos').updateOne(
      { code: req.body.promoCode.toUpperCase() },
      { $inc: { usedCount: 1 } }
    );
  }
  const { _id, ...safe } = order;
  sendOrderNotificationToAdmins(safe);
  res.json(safe);
});

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

// ── INVENTORY ALERT CHECK ──────────────────────────────────
async function checkInventoryAlerts() {
  try {
    const LOW_STOCK = 5;
    const products = await db.collection('products').find({ qty: { $lte: LOW_STOCK } }).toArray();
    if (!products.length) return;
    const admins = await db.collection('admins').find().toArray();
    const adminEmails = admins.map(a => a.email).filter(Boolean);
    if (!adminEmails.length) return;
    const rows = products.map(p => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${p.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;color:${p.qty===0?'#e53935':'#f57c00'};font-weight:700">${p.qty===0?'OUT OF STOCK':p.qty+' left'}</td>
    </tr>`).join('');
    const html = `<div style="font-family:sans-serif;max-width:500px;margin:auto;background:#fff;border-radius:12px;border:1px solid #eee;overflow:hidden">
      <div style="background:#FF5722;padding:20px 24px">
        <div style="font-size:20px;font-weight:800;color:#fff">⚠️ Low Stock Alert</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px">In Minutes — Inventory Warning</div>
      </div>
      <div style="padding:24px">
        <p style="color:#555;margin-bottom:16px">The following products need restocking:</p>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f9f9f9"><th style="padding:8px;text-align:left;font-size:12px;color:#888">PRODUCT</th><th style="padding:8px;text-align:center;font-size:12px;color:#888">STOCK</th></tr>
          ${rows}
        </table>
        <p style="margin-top:16px;font-size:12px;color:#aaa">Please update inventory from your admin panel.</p>
      </div>
    </div>`;
    for (const adminEmail of adminEmails) {
      await sendBrevoEmail(adminEmail, `Low Stock Alert - ${products.length} product(s) need restocking`, html);
    }
    console.log(`[Inventory Alert] Sent for ${products.length} products`);
  } catch(e) {
    console.error('[Inventory Alert Error]', e.message);
  }
}
// Check inventory every 6 hours
setInterval(checkInventoryAlerts, 6 * 60 * 60 * 1000);

// ── DELIVERY ZONES ────────────────────────────────────────
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
  // If no zones configured, allow all
  if (zones.length === 0) return res.json({ available: true, deliveryFee: 25, area: 'All Areas' });
  const zone = zones.find(z => z.pincode === pincode.toString().trim() && z.active);
  if (!zone) return res.json({ available: false, message: 'Sorry, we do not deliver to this pincode yet.' });
  res.json({ available: true, deliveryFee: zone.deliveryFee, area: zone.area, zone });
});

// ── PROMO CODES ───────────────────────────────────────────
app.get('/promos', async (req, res) => {
  const promos = await db.collection('promos').find().toArray();
  res.json(promos.map(({ _id, ...p }) => p));
});

app.post('/promos', async (req, res) => {
  const { code, type, value, minOrder, maxUses, expiresAt } = req.body;
  const existing = await db.collection('promos').findOne({ code: code.toUpperCase() });
  if (existing) return res.status(400).json({ error: 'Promo code already exists' });
  const promo = {
    id: Date.now(),
    code: code.toUpperCase(),
    type, // 'percent' or 'flat'
    value: Number(value),
    minOrder: Number(minOrder) || 0,
    maxUses: Number(maxUses) || 999999,
    usedCount: 0,
    expiresAt: expiresAt || null,
    active: true,
    createdAt: new Date().toISOString()
  };
  await db.collection('promos').insertOne(promo);
  res.json(promo);
});

app.delete('/promos/:id', async (req, res) => {
  await db.collection('promos').deleteOne({ id: Number(req.params.id) });
  res.json({ success: true });
});

app.put('/promos/:id/toggle', async (req, res) => {
  const promo = await db.collection('promos').findOne({ id: Number(req.params.id) });
  if (!promo) return res.status(404).json({ error: 'Not found' });
  await db.collection('promos').updateOne({ id: Number(req.params.id) }, { $set: { active: !promo.active } });
  res.json({ success: true });
});

app.post('/promos/validate', async (req, res) => {
  const { code, orderTotal } = req.body;
  const promo = await db.collection('promos').findOne({ code: code.toUpperCase() });
  if (!promo) return res.status(404).json({ error: 'Invalid promo code' });
  if (!promo.active) return res.status(400).json({ error: 'Promo code is inactive' });
  if (promo.expiresAt && new Date() > new Date(promo.expiresAt)) return res.status(400).json({ error: 'Promo code has expired' });
  if (promo.usedCount >= promo.maxUses) return res.status(400).json({ error: 'Promo code usage limit reached' });
  if (orderTotal < promo.minOrder) return res.status(400).json({ error: `Minimum order of Rs.${promo.minOrder} required` });
  const discount = promo.type === 'percent' ? Math.round(orderTotal * promo.value / 100) : promo.value;
  res.json({ success: true, discount, promo: { code: promo.code, type: promo.type, value: promo.value } });
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

// Test email route - helps diagnose email issues
app.get('/test-email/:to', async (req, res) => {
  try {
    await sendBrevoEmail(req.params.to, 'In Minutes - Email Test', '<h2>Email is working! ✅</h2><p>Your In Minutes email service is configured correctly.</p>');
    res.json({ success: true, api_key: process.env.BREVO_API_KEY ? 'SET' : 'NOT SET' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message, api_key: process.env.BREVO_API_KEY ? 'SET' : 'NOT SET' });
  }
});

// ── KEEP ALIVE ─────────────────────────────────────────────
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
    console.log(`\n   Database: MongoDB Atlas ✅`);
    console.log(`   Images:   Cloudinary ✅`);
    console.log(`   Email:    Gmail OTP ✅`);
  });
});