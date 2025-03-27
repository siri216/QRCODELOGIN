require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const fs = require("fs");
const cron = require("node-cron");

const app = express();
app.use(cors({ origin: "https://qrcodelogin-1-mldp.onrender.com" }));
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

app.post("/send-otp", (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone number is required!" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[phone] = otp;
    console.log(`Generated OTP for ${phone}: ${otp}`);

    res.json({ otp });
});

app.post("/verify-otp", (req, res) => {
    const { phone, otp } = req.body;
    if (otpStore[phone] && otpStore[phone].toString() === otp.toString()) {
        delete otpStore[phone];
        res.json({ success: true, message: "OTP Verified!" });
    } else {
        res.json({ success: false, message: "Invalid OTP!" });
    }
});

app.post("/scan-qr", async (req, res) => {
    const { serialNumber, phone } = req.body;
    if (!serialNumber || !phone) return res.status(400).json({ message: "Serial number and phone are required!" });

    try {
        await pool.query(
            "INSERT INTO scans (phone, serial_number, scanned_at) VALUES ($1, $2, NOW())",
            [phone, serialNumber]
        );

        fs.appendFileSync("scanned_qrcodes.csv", `${phone},${serialNumber},${new Date().toISOString()}\n`);
        res.json({ message: "QR Code scanned and stored successfully!" });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ message: "Database error", error });
    }
});

cron.schedule("0 0 * * *", async () => {
    try {
        const result = await pool.query("SELECT phone, COUNT(*) as count FROM scans WHERE scanned_at >= NOW() - INTERVAL '1 day' GROUP BY phone");
        result.rows.forEach(row => {
            console.log(`Phone ${row.phone} scanned ${row.count} QR codes today.`);
        });
    } catch (error) {
        console.error("Error generating daily summary:", error);
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
