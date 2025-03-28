require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();

// Middleware
app.use(cors({ 
    origin: ["https://qrcodelogin-1-mldp.onrender.com", "http://localhost:3000"] 
}));
app.use(bodyParser.json());

// PostgreSQL Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_k5PVEWXApj9L@ep-wild-sunset-a53nlyyu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.connect()
    .then(() => console.log("Connected to PostgreSQL Database"))
    .catch((err) => {
        console.error("Database connection failed: ", err);
        process.exit(1);
    });

// Store OTPs mapped to phone numbers
let otpStore = {};

// Base URL Route
app.get("/", (req, res) => {
    res.send("QR Code Login API Server is running successfully!");
});

// Generate and Send OTP
app.post("/send-otp", (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number is required!" });
    }

    if (phone.length !== 10) {
        return res.status(400).json({ success: false, message: "Phone number must be 10 digits!" });
    }

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    otpStore[phone] = {
        otp: otp,
        createdAt: new Date()
    };

    res.json({ success: true, otp: otp });
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
    const { phone, otp } = req.body;
    
    if (!otpStore[phone]) {
        return res.json({ success: false, message: "OTP expired or not generated!" });
    }

    // Check if OTP is expired (5 minutes)
    const otpAge = (new Date() - new Date(otpStore[phone].createdAt)) / 1000 / 60;
    if (otpAge > 5) {
        delete otpStore[phone];
        return res.json({ success: false, message: "OTP expired! Please request a new one." });
    }

    if (otpStore[phone].otp.toString() === otp.toString()) {
        delete otpStore[phone];
        res.json({ success: true, message: "OTP Verified!" });
    } else {
        res.json({ success: false, message: "Invalid OTP! Please try again." });
    }
});

// Scan QR Code
app.post("/scan-qr", async (req, res) => {
    const { serialNumber, phoneNumber } = req.body;

    if (!serialNumber || !phoneNumber) {
        return res.status(400).json({ 
            success: false, 
            message: "Both serial number and phone number are required!" 
        });
    }

    try {
        // Start transaction
        await pool.query('BEGIN');

        // 1. Check if QR code exists
        const qrCheck = await pool.query(
            `SELECT * FROM qr_codes WHERE serial_number = $1`,
            [serialNumber]
        );

        if (qrCheck.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.json({ 
                success: false, 
                message: "QR Code not found!",
                expired: false
            });
        }

        const qrCode = qrCheck.rows[0];

        // 2. Check if already scanned (optional - remove if allowing multiple scans)
        if (qrCode.scanned) {
            await pool.query('ROLLBACK');
            return res.json({ 
                success: false, 
                message: "QR Code already scanned!",
                expired: true,
                scannedAt: qrCode.scanned_at,
                scannedBy: qrCode.phone_number
            });
        }

        // 3. Update QR code record
        const updateResult = await pool.query(
            `UPDATE qr_codes 
             SET phone_number = $1, scanned = TRUE, scanned_at = NOW() 
             WHERE serial_number = $2
             RETURNING *`,
            [phoneNumber, serialNumber]
        );

        await pool.query('COMMIT');

        // 4. Get total scans by this phone number
        const totalScans = await getTotalScansByPhone(phoneNumber);

        res.json({ 
            success: true, 
            message: "QR Code scanned successfully!",
            scanData: updateResult.rows[0],
            totalScans: totalScans
        });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error("Scan error:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Error processing QR scan",
            error: error.message 
        });
    }
});

// Get all scans for a phone number
app.get("/scans/:phoneNumber", async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        
        if (!phoneNumber || phoneNumber.length !== 10) {
            return res.status(400).json({
                success: false,
                message: "Valid 10-digit phone number required"
            });
        }

        const result = await pool.query(
            `SELECT serial_number, scanned_at 
             FROM qr_codes 
             WHERE phone_number = $1
             ORDER BY scanned_at DESC`,
            [phoneNumber]
        );

        res.json({
            success: true,
            phoneNumber: phoneNumber,
            totalScans: result.rows.length,
            scans: result.rows
        });
    } catch (error) {
        console.error("Error fetching scans:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper function to get total scans by a phone number
async function getTotalScansByPhone(phoneNumber) {
    const result = await pool.query(
        `SELECT COUNT(*) FROM qr_codes WHERE phone_number = $1`,
        [phoneNumber]
    );
    return parseInt(result.rows[0].count, 10);
}

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: new Date(),
        database: pool ? "connected" : "disconnected"
    });
});

// Start the server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', async () => {
    await pool.end();
    process.exit();
});
