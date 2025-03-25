require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
app.use(cors({ origin: "https://qrcodelogin-1.onrender.com" }));
app.use(bodyParser.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log("Connected to PostgreSQL Database"))
    .catch((err) => {
        console.error("Database connection failed: ", err);
        process.exit(1);
    });

let otpStore = {};

// Health Check
app.get("/", (req, res) => {
    res.send("Server is running successfully!");
});

// Send OTP
app.post("/send-otp", (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ message: "Phone number is required!" });
    }

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    otpStore[phone] = otp;
    console.log(`Generated OTP for ${phone}: ${otp}`);

    res.json({ otp, message: "OTP sent successfully." });
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
    const { phone, otp } = req.body;
    if (otpStore[phone] && otpStore[phone].toString() === otp.toString()) {
        delete otpStore[phone];
        res.json({ success: true, message: "OTP Verified Successfully!" });
    } else {
        res.status(401).json({ success: false, message: "Invalid OTP! Please try again." });
    }
});

// Fetch and Validate QR Code
app.post("/fetch-user-details", async (req, res) => {
    const { serialNumber, phone } = req.body;

    if (!serialNumber || !phone) {
        return res.status(400).json({ success: false, message: "Serial Number and Phone are required." });
    }

    try {
        const qrCode = await pool.query("SELECT * FROM qr_codes WHERE serial_number = $1", [serialNumber]);

        if (qrCode.rowCount === 0) {
            return res.status(404).json({ success: false, message: "QR Code not found" });
        }

        const qrData = qrCode.rows[0];

        if (qrData.scanned) {
            return res.status(400).json({ success: false, expired: true, message: "QR Code already used!" });
        }

        await pool.query(
            "UPDATE qr_codes SET scanned = TRUE, scanned_at = NOW(), phone_number = $1 WHERE serial_number = $2",
            [phone, serialNumber]
        );

        return res.status(200).json({ success: true, userId: qrData.id, message: "QR Code scanned successfully!" });
    } catch (error) {
        console.error("Error fetching user details:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
