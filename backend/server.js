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

// Health Check
app.get("/", (req, res) => {
    res.send("Server is running successfully!");
});

// Fetch and Validate QR Code
app.post("/fetch-user-details", async (req, res) => {
    const { serialNumber } = req.body; // Removed phone as it was not used

    if (!serialNumber) {
        return res.status(400).json({ success: false, message: "Serial Number is required." });
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
            "UPDATE qr_codes SET scanned = TRUE, scanned_at = NOW() WHERE serial_number = $1",
            [serialNumber]
        );

        return res.status(200).json({ success: true, userId: qrData.id, message
