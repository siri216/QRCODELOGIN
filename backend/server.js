require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();

// Enhanced CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions));
app.use(bodyParser.json());

// Enhanced PostgreSQL Connection Pool with retry logic
const createPool = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_k5PVEWXApj9L@ep-wild-sunset-a53nlyyu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ssl: { 
      rejectUnauthorized: false 
    },
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
    // Implement reconnection logic here if needed
  });

  return pool;
};

const pool = createPool();

// Database connection health check with retries
async function ensureDatabaseConnection(retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("✅ Database connection established");
      return true;
    } catch (err) {
      console.error(`Attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error("Failed to connect to database after multiple attempts");
}

// Initialize database connection
ensureDatabaseConnection().catch(err => {
  console.error("Database connection failed:", err);
  process.exit(1);
});

// Enhanced OTP store with expiration
const otpStore = new Map();

// Generate and Send OTP with rate limiting
app.post("/send-otp", (req, res) => {
  const { phone } = req.body;
  
  // Input validation
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ 
      success: false, 
      message: "Valid 10-digit phone number is required!" 
    });
  }

  // Rate limiting check
  const existingOTP = otpStore.get(phone);
  if (existingOTP && (Date.now() - existingOTP.createdAt < 30000)) {
    return res.status(429).json({
      success: false,
      message: "Please wait before requesting another OTP"
    });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(phone, {
    otp,
    createdAt: Date.now(),
    attempts: 0
  });

  console.log(`Generated OTP for ${phone}: ${otp}`);
  res.json({ 
    success: true, 
    otp, // Remove in production - only for testing
    message: "OTP sent successfully" 
  });
});

// Verify OTP with attempt tracking
app.post("/verify-otp", (req, res) => {
  const { phone, otp } = req.body;
  
  if (!phone || !otp) {
    return res.status(400).json({ 
      success: false, 
      message: "Phone number and OTP are required!" 
    });
  }

  const storedOTP = otpStore.get(phone);
  
  // OTP expiration (5 minutes)
  if (!storedOTP || Date.now() - storedOTP.createdAt > 300000) {
    otpStore.delete(phone);
    return res.json({ 
      success: false, 
      message: "OTP expired! Please request a new one." 
    });
  }

  // Increment attempt counter
  storedOTP.attempts++;
  otpStore.set(phone, storedOTP);

  if (storedOTP.attempts > 5) {
    otpStore.delete(phone);
    return res.json({ 
      success: false, 
      message: "Too many attempts! Please request a new OTP." 
    });
  }

  if (storedOTP.otp === otp) {
    otpStore.delete(phone);
    return res.json({ 
      success: true, 
      message: "OTP Verified!",
      token: generateAuthToken(phone) // Implement JWT generation
    });
  }

  return res.json({ 
    success: false, 
    message: "Invalid OTP!",
    attemptsRemaining: 5 - storedOTP.attempts
  });
});

// QR Code Scanning with transaction and validation
app.post("/scan-qr", async (req, res) => {
  const { serialNumber, phone } = req.body;
  
  if (!serialNumber || !phone) {
    return res.status(400).json({ 
      success: false, 
      message: "Serial number and phone number are required!" 
    });
  }

  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // 1. Verify QR code exists and is active
    const qrCheck = await client.query(
      `SELECT id FROM qr_codes 
       WHERE serial_number = $1 AND is_active = TRUE
       FOR UPDATE`,
      [serialNumber]
    );

    if (qrCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ 
        success: false, 
        message: "QR Code not found or inactive!" 
      });
    }

    // 2. Check if user already scanned this code
    const userScan = await client.query(
      `SELECT scanned_at FROM user_qr_scans
       WHERE phone_number = $1 AND serial_number = $2`,
      [phone, serialNumber]
    );

    if (userScan.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.json({ 
        success: false, 
        message: "You've already scanned this QR code!",
        scannedAt: userScan.rows[0].scanned_at
      });
    }

    // 3. Record the scan
    await client.query(
      `INSERT INTO user_qr_scans 
       (phone_number, serial_number, scanned_at)
       VALUES ($1, $2, NOW())`,
      [phone, serialNumber]
    );

    await client.query(
      `UPDATE qr_codes 
       SET scan_count = scan_count + 1
       WHERE serial_number = $1`,
      [serialNumber]
    );

    await client.query("COMMIT");
    
    return res.json({ 
      success: true, 
      message: "QR Code scanned successfully!" 
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Scan error:", error);
    
    if (error.code === "23505") { // Unique violation
      return res.json({ 
        success: false, 
        message: "This QR code was already scanned by you!" 
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: "Error processing scan",
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Get user scans with pagination
app.post("/get-user-scans", async (req, res) => {
  const { phone, page = 1, limit = 10 } = req.body;
  
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ 
      success: false, 
      message: "Valid phone number is required!" 
    });
  }

  try {
    const offset = (page - 1) * limit;
    
    const result = await pool.query(
      `SELECT q.serial_number, u.scanned_at, q.scan_count as total_scans
       FROM user_qr_scans u
       JOIN qr_codes q ON u.serial_number = q.serial_number
       WHERE u.phone_number = $1 
       ORDER BY u.scanned_at DESC
       LIMIT $2 OFFSET $3`,
      [phone, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM user_qr_scans WHERE phone_number = $1`,
      [phone]
    );

    return res.json({
      success: true,
      scans: result.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      limit
    });

  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Error fetching scans" 
    });
  }
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ 
      status: "healthy",
      database: "connected",
      timestamp: new Date() 
    });
  } catch (error) {
    res.status(500).json({ 
      status: "unhealthy",
      database: "disconnected",
      error: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ 
    success: false, 
    message: "Internal server error" 
  });
});

// Start server
const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

function gracefulShutdown() {
  console.log("Shutting down gracefully...");
  server.close(async () => {
    await pool.end();
    console.log("Server and database connections closed");
    process.exit(0);
  });
}
