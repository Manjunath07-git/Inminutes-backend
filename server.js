const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 🔌 Import HTTP and Socket.io
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// 🔌 Create HTTP Server and bind Socket.io
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

// ── EMAIL ──────────────────────────────────────────────────
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
  try {
    const admins = await db.collection('admins').find({ role: { $in: ['admin', 'head'] } }).toArray();
    const adminEmails = admins.map(a => a.email).filter(Boolean);
    if (!adminEmails.length) return;

    const itemsList = order.items.map(i => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">Rs.${i.price * i.quantity}</td>
    </tr>`).join('');

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;background:#fff;border:1px solid #eee;border-radius:12px;overflow:hidden">
        <div style="background:#166534;padding:20px 24px">
          <div style="font-size:22px;font-weight:800;color:#fff">In Minutes</div>
          <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px">New Order Received!</div>
        </div>
        <div style="padding:24px">
          <div style="background:#F0FBF4;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-size:13px;color:#888;margin-bottom:4px">Order ID</div>
            <div style="font-size:20px;font-weight:800;color:#166534">${order.id}</div>
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
              <td style="padding:10px 8px;font-weight:800;font-size:16px;text-align:right;color:#166534">Rs.${order.total}</td>
            </tr>
          </table>
          <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-size:12px;color:#888;margin-bottom:8px;font-weight:700;text-transform:uppercase">Customer Details</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Name:</strong> ${order.userName}</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Phone:</strong> ${order.userPhone}</div>
            <div style="font-size:13px;color:#333;margin-bottom:4px"><strong>Email:</strong> ${order.userEmail}</div>
            <div style="font-size:13px;color:#333"><strong>Address:</strong> ${order.address?.line1 || ''}, ${order.address?.city || ''} - ${order.address?.pincode || ''}</div>
          </div>
          
          <div style="margin-top:24px;text-align:center">
            <a href="${process.env.ADMIN_PANEL_URL || 'https://inminutes-admin.vercel.app'}" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.5px;">
              Open Admin Panel ➔
            </a>
            <div style="font-size:12px;color:#aaa;margin-top:14px">Login to view full details and update the delivery status.</div>
          </div>

        </div>
      </div>
    `;

    for (const adminEmail of adminEmails) {
      await sendBrevoEmail(adminEmail, `New Order ${order.id} - Rs.${order.total} from ${order.userName}`, html);
    }
  } catch(e) {}
}

async function sendDeliveryConfirmationEmail(order) {
  try {
    if (!order.userEmail) return; 
    const itemsList = order.items.map(i => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
    </tr>`).join('');

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;background:#fff;border:1px solid #eee;border-radius:12px;overflow:hidden">
        <div style="background:#166534;padding:20px 24px">
          <div style="font-size:22px;font-weight:800;color:#fff">In Minutes</div>
          <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px">Your Order Has Been Delivered! 🎉</div>
        </div>
        <div style="padding:24px">
          <p style="color:#333;font-size:16px;">Hi ${order.userName},</p>
          <p style="color:#555;">Great news! Your order <strong>${order.id}</strong> has been successfully delivered to your address.</p>
          <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px;margin:16px 0">
            <table style="width:100%;border-collapse:collapse;">
              <tr style="background:#f9f9f9">
                <th style="padding:8px;text-align:left;font-size:12px;color:#888">ITEM</th>
                <th style="padding:8px;text-align:center;font-size:12px;color:#888">QTY</th>
              </tr>
              ${itemsList}
            </table>
          </div>
          <p style="color:#555;">Thank you for shopping with In Minutes! We hope to see you again soon.</p>
        </div>
      </div>
    `;
    await sendBrevoEmail(order.userEmail, `Order Delivered! 🎉 (${order.id})`, html);
  } catch (e) {}
}

async function sendOTP(email, otp, purpose) {
  const subject = purpose === 'register' ? 'Verify your In Minutes account' : 'Reset your In Minutes password';
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A0A0F;color:#F5F0E8;padding:32px;border-radius:16px"><div style="font-size:24px;font-weight:800;margin-bottom:8px">In <span style="color:#FF5C3A">Minutes</span></div><p style="color:#aaa;margin-bottom:24px">${purpose === 'register' ? 'Welcome! Verify your email to get started.' : 'Reset your account password.'}</p><div style="background:#1a1a2e;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px"><div style="font-size:13px;color:#aaa;margin-bottom:8px">Your OTP code</div><div style="font-size:40px;font-weight:800;letter-spacing:8px;color:#FF5C3A">${otp}</div><div style="font-size:12px;color:#aaa;margin-top:8px">Valid for 10 minutes</div></div></div>`;
  await sendBrevoEmail(email, subject, html);
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
  if (!email) return res.status(400).json({ error: 'Email required' });
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
  const { email, otp } = req.body;
  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: 'No OTP sent.' });
  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired.' });
  }
  if (record.otp !== otp) return res.status(400).json({ error: 'Invalid OTP.' });
  delete otpStore[email];
  res.json({ success: true });
});

app.put('/users/:id/profile', authenticateToken, async (req, res) => {
  if (req.user.id !== Number(req.params.id)) return res.status(403).json({ error: 'Unauthorized' });
  const { name, email } = req.body;
  await db.collection('users').updateOne({ id: req.params.id }, { $set: { name, email } });
  const updated = await db.collection('users').findOne({ id: req.params.id });
  const { password: _, _id, ...safe } = updated;
  safe.token = req.headers['authorization'].split(' ')[1]; 
  res.json(safe);
});

app.post('/users/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;
  const user = await db.collection('users').findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.collection('users').updateOne({ email }, { $set: { password: hashed } });
  res.json({ success: true });
});

// ── PRODUCTS (No Multer Needed Anymore) ──────────────────────
app.get('/products', async (req, res) => {
  const products = await db.collection('products').find().toArray();
  res.json(products);
});

app.post('/products', authenticateToken, async (req, res) => {
  const p = { id: Date.now(), ...req.body, createdAt: new Date().toISOString() };
  await db.collection('products').insertOne(p);
  res.json(p);
});

app.put('/products/:id', authenticateToken, async (req, res) => {
  await db.collection('products').updateOne(
    { id: Number(req.params.id) },
    { $set: req.body }
  );
  res.json({ success: true });
});

app.delete('/products/:id', authenticateToken, async (req, res) => {
  await db.collection('products').deleteOne({ id: Number(req.params.id) });
  res.json({ success: true });
});

// ── ADMINS ─────────────────────────────────────────────────
app.get('/admins', async (req, res) => {
  const admins = await db.collection('admins').find().toArray();
  res.json(admins.map(({ password, _id, ...a }) => a));
});

app.post('/admins', authenticateToken, async (req, res) => {
  const { name, email, password, role } = req.body;
  const existing = await db.collection('admins').findOne({ email });
  if (existing) return res.status(400).json({ error: 'Email already exists' });
  const hashed = await bcrypt.hash(password, 10);
  const admin = { id: 'adm_' + Date.now(), name, email, password: hashed, role: role || 'admin', createdAt: new Date().toISOString() };
  await db.collection('admins').insertOne(admin);
  res.json({ success: true });
});

app.delete('/admins/:id', authenticateToken, async (req, res) => {
  if (req.params.id === 'head_001') return res.status(403).json({ error: 'Cannot delete head admin' });
  await db.collection('admins').deleteOne({ id: req.params.id });
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

app.post('/users/:id/address', authenticateToken, async (req, res) => {
  const addr = { id: Date.now(), ...req.body };
  await db.collection('users').updateOne({ id: Number(req.params.id) }, { $push: { addresses: addr } });
  const user = await db.collection('users').findOne({ id: Number(req.params.id) });
  const { password, _id, ...safe } = user;
  safe.token = req.headers['authorization'].split(' ')[1];
  res.json(safe);
});

app.delete('/users/:id/address/:addrId', authenticateToken, async (req, res) => {
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

// 🚀 PAGINATED ORDERS ROUTE
app.get('/orders/paginated', authenticateToken, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  try {
    const totalOrders = await db.collection('orders').countDocuments();
    const orders = await db.collection('orders')
      .find()
      .sort({ createdAt: -1 }) 
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      orders: orders.map(({ _id, ...o }) => o),
      totalPages: Math.ceil(totalOrders / limit),
      currentPage: page,
      totalOrders
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

app.get('/orders/user/:userId', authenticateToken, async (req, res) => {
  const orders = await db.collection('orders').find({ userId: Number(req.params.userId) }).toArray();
  res.json(orders.map(({ _id, ...o }) => o));
});

app.post('/orders', authenticateToken, async (req, res) => {
  const { userId, items, paymentMethod, address, location } = req.body;
  const products = await db.collection('products').find().toArray();
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    if (!p) return res.status(400).json({ error: 'Product not found' });
    // CHANGED: Now checks 'unit' instead of 'qty'
    if (p.unit < item.quantity) return res.status(400).json({ error: `Only ${p.unit} units of "${p.name}" available` });
  }
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    await db.collection('products').updateOne(
      { id: item.productId },
      // CHANGED: Now deducts from 'unit' instead of 'qty'
      { $set: { unit: p.unit - item.quantity, inStock: (p.unit - item.quantity) > 0 } }
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
  
  io.emit('newOrderReceived', safe);
  sendOrderNotificationToAdmins(safe);
  res.json(safe);
});

app.put('/orders/:id/status', authenticateToken, async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const newStatus = req.body.status;
  const order = await db.collection('orders').findOne({ id });
  if (newStatus === 'Cancelled' && order.status !== 'Cancelled') {
    for (const item of order.items) {
      const product = await db.collection('products').findOne({ id: item.productId });
      if (product) {
        // CHANGED: Now restores 'unit' instead of 'qty'
        const newUnit = (product.unit || 0) + item.quantity;
        await db.collection('products').updateOne(
          { id: item.productId },
          { $set: { unit: newUnit, inStock: newUnit > 0 } }
        );
      }
    }
  }
  await db.collection('orders').updateOne({ id }, { $set: { status: newStatus } });
  
  const updatedOrder = await db.collection('orders').findOne({ id });
  const { _id, ...safeOrder } = updatedOrder;
  
  io.emit('orderStatusUpdated', safeOrder);

  if (newStatus === 'Delivered' && order.status !== 'Delivered') {
    sendDeliveryConfirmationEmail(safeOrder);
  }
  res.json({ success: true });
});

app.delete('/orders/:id', authenticateToken, async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await db.collection('orders').deleteOne({ id });
  res.json({ success: true });
});

app.delete('/orders/bulk/:type', authenticateToken, async (req, res) => {
  if(req.params.type === "delivered") await db.collection('orders').deleteMany({ status: 'Delivered' });
  else if(req.params.type === "cancelled") await db.collection('orders').deleteMany({ status: 'Cancelled' });
  else if(req.params.type === "old") {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.collection('orders').deleteMany({ createdAt: { $lt: cutoff } });
  }
  res.json({ success: true });
});

app.put('/orders/:id/seen', authenticateToken, async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await db.collection('orders').updateOne({ id }, { $set: { isNew: false } });
  res.json({ success: true });
});

app.put('/orders/:id/claim', authenticateToken, async (req, res) => {
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

app.put('/orders/:id/unclaim', authenticateToken, async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  await db.collection('orders').updateOne({ id }, { 
    $unset: { claimedBy: '', claimedByName: '', claimedAt: '' } 
  });
  res.json({ success: true });
});

app.get('/orders/:id/tracking', authenticateToken, async (req, res) => {
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

app.put('/admins/:id/location', authenticateToken, async (req, res) => {
  const { lat, lng } = req.body;
  await db.collection('admins').updateOne(
    { id: req.params.id },
    { $set: { location: { lat, lng }, locationUpdatedAt: new Date().toISOString() } }
  );
  res.json({ success: true });
});

// ── DELIVERY ZONES & PROMOS ────────────────────────────────────────
app.get('/zones', async (req, res) => {
  const zones = await db.collection('zones').find().toArray();
  res.json(zones.map(({ _id, ...z }) => z));
});
app.post('/zones', authenticateToken, async (req, res) => {
  const { pincode, area, deliveryFee, active } = req.body;
  const existing = await db.collection('zones').findOne({ pincode });
  if (existing) return res.status(400).json({ error: 'Pincode already exists' });
  const zone = { id: Date.now(), pincode: pincode.toString().trim(), area: area.trim(), deliveryFee: Number(deliveryFee) || 25, active: active !== false, createdAt: new Date().toISOString() };
  await db.collection('zones').insertOne(zone);
  res.json(zone);
});
app.delete('/zones/:id', authenticateToken, async (req, res) => {
  await db.collection('zones').deleteOne({ id: Number(req.params.id) });
  res.json({ success: true });
});
app.put('/zones/:id', authenticateToken, async (req, res) => {
  const { area, deliveryFee, active } = req.body;
  await db.collection('zones').updateOne({ id: Number(req.params.id) }, { $set: { area, deliveryFee: Number(deliveryFee), active } });
  res.json({ success: true });
});

app.get('/promos', async (req, res) => {
  const promos = await db.collection('promos').find().toArray();
  res.json(promos.map(({ _id, ...p }) => p));
});
app.post('/promos', authenticateToken, async (req, res) => {
  const { code, type, value, minOrder, maxUses, expiresAt } = req.body;
  const existing = await db.collection('promos').findOne({ code: code.toUpperCase() });
  if (existing) return res.status(400).json({ error: 'Promo code already exists' });
  const promo = { id: Date.now(), code: code.toUpperCase(), type, value: Number(value), minOrder: Number(minOrder) || 0, maxUses: Number(maxUses) || 999999, usedCount: 0, expiresAt: expiresAt || null, active: true, createdAt: new Date().toISOString() };
  await db.collection('promos').insertOne(promo);
  res.json(promo);
});
app.delete('/promos/:id', authenticateToken, async (req, res) => {
  await db.collection('promos').deleteOne({ id: Number(req.params.id) });
  res.json({ success: true });
});
app.put('/promos/:id/toggle', authenticateToken, async (req, res) => {
  const promo = await db.collection('promos').findOne({ id: Number(req.params.id) });
  await db.collection('promos').updateOne({ id: Number(req.params.id) }, { $set: { active: !promo.active } });
  res.json({ success: true });
});

// 🚀 STATS ROUTE (MongoDB Aggregation)
app.get('/stats', authenticateToken, async (req, res) => {
  try {
    const products = await db.collection('products').countDocuments();
    const users = await db.collection('users').countDocuments();
    const admins = await db.collection('admins').countDocuments();
    const totalOrders = await db.collection('orders').countDocuments();

    const revenueAggregation = await db.collection('orders').aggregate([
      { $match: { status: 'Delivered' } },
      { $group: { _id: null, totalRevenue: { $sum: "$total" } } }
    ]).toArray();
    const revenue = revenueAggregation.length > 0 ? revenueAggregation[0].totalRevenue : 0;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const chartAgg = await db.collection('orders').aggregate([
      { $match: { status: 'Delivered', createdAt: { $gte: sevenDaysAgo.toISOString() } } },
      { $group: {
          _id: { $substr: ["$createdAt", 0, 10] }, 
          rev: { $sum: "$total" }
        }
      }
    ]).toArray();

    res.json({ products, orders: totalOrders, users, admins: admins - 1, revenue, chartData: chartAgg });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
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
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅  In Minutes backend running!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Database: MongoDB Atlas ✅`);
    console.log(`   Security: JWT Token Auth 🔒`);
    console.log(`   Live:     WebSockets Enabled 📡`);
    console.log(`   Scale:    DB Aggregation Enabled 🚀`);
  });
});