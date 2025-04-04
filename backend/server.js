require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();

// Middleware
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// Database Configuration
const poolConfig = {
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_k5PVEWXApj9L@ep-wild-sunset-a53nlyyu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
  max: 5,
  min: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};

const pool = new Pool(poolConfig);

// Connection error handling
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// Immediate health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'server-running',
    timestamp: new Date() 
  });
});

// Test database connection with retries
async function testDatabaseConnection(retries = 3, delay = 5000) {
  let client;
  for (let i = 0; i < retries; i++) {
    try {
      client = await pool.connect();
      await client.query('SELECT 1');
      console.log('✅ Database connection established');
      return true;
    } catch (err) {
      console.error(`Database connection attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } finally {
      if (client) client.release();
    }
  }
  throw new Error('Failed to connect to database after multiple attempts');
}

// Enhanced health check with database verification
app.get('/health/full', async (req, res) => {
  try {
    const dbConnected = await testDatabaseConnection(1); // Quick test
    res.status(200).json({
      status: dbConnected ? 'healthy' : 'degraded',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date()
    });
  }
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

  res.json({
    success: true,
    message: 'OTP sent successfully',
    otp: otp // Remove this in production!
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

// Start server with proper initialization
async function startServer() {
  try {
    // Start listening immediately
    const PORT = process.env.PORT || 10000;
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Test database connection in background
    testDatabaseConnection().catch(err => {
      console.error('Database connection warning:', err.message);
    });

    return server;
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
function shutdown() {
  console.log('Shutting down gracefully...');
  pool.end(() => {
    console.log('Database connections closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the application
startServer().then(() => {
  console.log('Application started successfully');
}).catch(err => {
  console.error('Application failed to start:', err);
  process.exit(1);
});
