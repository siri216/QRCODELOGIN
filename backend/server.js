require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
app.use(cors({ origin: "*" })); // Adjust origin as needed
app.use(bodyParser.json());

// PostgreSQL Database Connection
const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_k5PVEWXApj9L@ep-wild-sunset-a53nlyyu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ssl: { rejectUnauthorized: false }
});

// Test database connection
pool.connect()
    .then(() => console.log("Connected to PostgreSQL Database"))
    .catch((err) => {
        console.error("Database connection failed: ", err);
        process.exit(1);
    });

let otpStore = {};

// Generate and Send OTP
app.post("/send-otp", (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone number is required!" });

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    otpStore[phone] = otp;
    console.log(`Generated OTP for ${phone}: ${otp}`);

    res.json({ otp });
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
    const { phone, otp } = req.body;
    if (otpStore[phone] && otpStore[phone].toString() === otp.toString()) {
        delete otpStore[phone];
        res.json({ success: true, message: "OTP Verified!" });
    } else {
        res.json({ success: false, message: "Invalid OTP! Please try again." });
    }
});

// Scan QR Code and store with phone number
app.post("/scan-qr", async (req, res) => {
    const { serialNumber, phone } = req.body;
    if (!serialNumber || !phone) {
        return res.status(400).json({ message: "Serial number and phone number are required!" });
    }

    try {
        // Check if QR code exists
        const qrCheck = await pool.query(
            "SELECT * FROM qr_codes WHERE serial_number = $1", 
            [serialNumber]
        );

        if (qrCheck.rows.length === 0) {
            return res.json({ message: "QR Code not found!" });
        }

        // Check if this user already scanned this QR code
        const userScanCheck = await pool.query(
            `SELECT * FROM user_qr_scans 
             WHERE phone_number = $1 AND serial_number = $2`,
            [phone, serialNumber]
        );

        if (userScanCheck.rows.length > 0) {
            return res.json({ 
                message: "You have already scanned this QR code!",
                duplicate: true
            });
        }

        // Record the scan in both tables
        await pool.query('BEGIN');
        
        // Update qr_codes table
        await pool.query(
            `UPDATE qr_codes 
             SET scanned = TRUE, scanned_by = $1, scan_timestamp = NOW() 
             WHERE serial_number = $2`,
            [phone, serialNumber]
        );
        
        // Add to user_qr_scans table
        await pool.query(
            `INSERT INTO user_qr_scans (phone_number, serial_number, scanned_at)
             VALUES ($1, $2, NOW())`,
            [phone, serialNumber]
        );
        
        await pool.query('COMMIT');

        return res.json({ 
            message: "QR Code scanned successfully!",
            success: true
        });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error("Database error:", error);
        
        if (error.code === '23505') { // Unique violation
            return res.json({ message: "This QR code was already scanned by you!" });
        }
        
        return res.status(500).json({ message: "Database error", error });
    }
});

// Get all scanned QR codes for a user
app.post("/get-user-scans", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone number is required!" });

    try {
        const result = await pool.query(
            `SELECT q.serial_number, u.scanned_at 
             FROM user_qr_scans u
             JOIN qr_codes q ON u.serial_number = q.serial_number
             WHERE u.phone_number = $1 
             ORDER BY u.scanned_at DESC`,
            [phone]
        );

        return res.json({
            success: true,
            scans: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error("Database error:", error);
        return res.status(500).json({ message: "Database error", error });
    }
});

// Add new QR codes (admin endpoint)
app.post("/add-qr-code", async (req, res) => {
    const { serialNumber } = req.body;
    if (!serialNumber) return res.status(400).json({ message: "Serial number is required!" });

    try {
        await pool.query(
            "INSERT INTO qr_codes (serial_number) VALUES ($1)",
            [serialNumber]
        );
        return res.json({ success: true, message: "QR Code added successfully!" });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ message: "This QR code already exists!" });
        }
        console.error("Database error:", error);
        return res.status(500).json({ message: "Database error", error });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
