require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));
app.use(bodyParser.json());

// Database Connection with Pooling
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_k5PVEWXApj9L@ep-wild-sunset-a53nlyyu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000
});

// Test connection
pool.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
  });

// OTP Storage (in-memory for demo)
const otpStore = new Map();

// Generate and Send OTP
app.post('/send-otp', (req, res) => {
  const { phone } = req.body;

  // Validate phone
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ 
      success: false,
      message: 'Valid 10-digit phone number required'
    });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Store with timestamp (expires in 5 mins)
  otpStore.set(phone, {
    otp,
    createdAt: Date.now(),
    attempts: 0
  });

  console.log(`OTP for ${phone}: ${otp}`); // Remove in production!

  // In production, send via SMS service here
  res.json({
    success: true,
    message: 'OTP sent successfully',
    otp: otp // Remove this line in production!
  });
});

// Verify OTP
app.post('/verify-otp', (req, res) => {
  const { phone, otp } = req.body;

  // Validate input
  if (!phone || !otp || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: 'Valid phone and 6-digit OTP required'
    });
  }

  const storedData = otpStore.get(phone);
  
  // Check if OTP exists
  if (!storedData) {
    return res.json({
      success: false,
      message: 'OTP expired or not found'
    });
  }

  // Check expiration (5 minutes)
  if (Date.now() - storedData.createdAt > 300000) {
    otpStore.delete(phone);
    return res.json({
      success: false,
      message: 'OTP expired. Please request a new one.'
    });
  }

  // Increment attempt counter
  storedData.attempts++;
  otpStore.set(phone, storedData);

  // Block after 5 attempts
  if (storedData.attempts > 5) {
    otpStore.delete(phone);
    return res.json({
      success: false,
      message: 'Too many attempts. Please request a new OTP.'
    });
  }

  // Verify OTP
  if (storedData.otp === otp) {
    otpStore.delete(phone);
    return res.json({
      success: true,
      message: 'OTP verified successfully!'
    });
  }

  return res.json({
    success: false,
    message: 'Invalid OTP',
    attemptsLeft: 5 - storedData.attempts
  });
});

// Scan QR Code
app.post('/scan-qr', async (req, res) => {
  const { serialNumber, phone } = req.body;
  
  if (!serialNumber || !phone) {
    return res.status(400).json({
      success: false,
      message: 'Both serial number and phone are required'
    });
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Verify QR code exists
    const qrCheck = await client.query(
      'SELECT * FROM qr_codes WHERE serial_number = $1',
      [serialNumber]
    );

    if (qrCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: false,
        message: 'QR code not found'
      });
    }

    // 2. Check if already scanned by this user
    const scanCheck = await client.query(
      `SELECT scanned_at FROM user_scans 
       WHERE phone = $1 AND serial_number = $2`,
      [phone, serialNumber]
    );

    if (scanCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: false,
        message: 'You already scanned this code',
        scannedAt: scanCheck.rows[0].scanned_at
      });
    }

    // 3. Record the scan
    await client.query(
      `INSERT INTO user_scans (phone, serial_number)
       VALUES ($1, $2)`,
      [phone, serialNumber]
    );

    await client.query('COMMIT');
    
    return res.json({
      success: true,
      message: 'QR code scanned successfully!'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Scan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing scan'
    });
  } finally {
    client.release();
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  pool.end(() => {
    console.log('Pool ended');
    process.exit(0);
  });
});
