require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
app.use(cors({ origin: "https://qrcodelogin-1-mldp.onrender.com" }));
app.use(bodyParser.json());

// PostgreSQL Database Connection
const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_k5PVEWXApj9L@ep-wild-sunset-a53nlyyu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
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
    res.send("Server is running successfully!");
});

// Generate and Send OTP
app.post("/send-otp", (req, res) => {
    console.log("Received request body:", req.body);
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ message: "Phone number is required!" });
    }

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    otpStore[phone] = {
        otp: otp,
        createdAt: new Date()
    };
    console.log(`Generated OTP for ${phone}: ${otp}`);

    res.json({ otp });
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

// Scan QR Code and store in database
app.post("/scan-qr", async (req, res) => {
    const { serialNumber, phoneNumber } = req.body;
    console.log("Received scan request:", { serialNumber, phoneNumber });

    if (!serialNumber) {
        return res.status(400).json({ success: false, message: "Serial number is required!" });
    }

    if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Phone number is required!" });
    }

    try {
        // Check if QR code exists
        const checkResult = await pool.query(
            "SELECT * FROM qr_codes WHERE serial_number = $1", 
            [serialNumber]
        );

        if (checkResult.rows.length === 0) {
            return res.json({ 
                success: false, 
                message: "QR Code not found!",
                expired: false
            });
        }

        const qrCode = checkResult.rows[0];

        // Check if already scanned
        if (qrCode.scanned) {
            return res.json({ 
                success: false, 
                message: "QR Code already scanned!",
                expired: true,
                scannedAt: qrCode.scanned_at,
                scannedBy: qrCode.phone_number
            });
        }

        // Update QR code record
        const updateResult = await pool.query(
            `UPDATE qr_codes 
             SET phone_number = $1, scanned = TRUE, scanned_at = NOW() 
             WHERE serial_number = $2
             RETURNING *`,
            [phoneNumber, serialNumber]
        );

        res.json({ 
            success: true, 
            message: "QR Code scanned successfully!",
            data: updateResult.rows[0]
        });

    } catch (error) {
        console.error("Database error:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Database error",
            error: error.message 
        });
    }
});

// Additional endpoint to check QR code status
app.post("/check-qr", async (req, res) => {
    const { serialNumber } = req.body;
    
    try {
        const result = await pool.query(
            "SELECT * FROM qr_codes WHERE serial_number = $1",
            [serialNumber]
        );

        if (result.rows.length === 0) {
            return res.json({ exists: false });
        }

        res.json({
            exists: true,
            scanned: result.rows[0].scanned,
            scannedAt: result.rows[0].scanned_at,
            phoneNumber: result.rows[0].phone_number
        });
    } catch (error) {
        console.error("Error checking QR code:", error);
        res.status(500).json({ error: "Database error" });
    }
});

// Start the server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
