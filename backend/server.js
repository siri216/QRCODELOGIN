require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const PDFDocument = require("pdfkit"); // PDF generation library

const app = express();
app.use(cors({ origin: "https://qrcodelogin-1.onrender.com" }));
app.use(bodyParser.json());

const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_TeDH7Gu4bWfn@ep-fancy-fire-a5fzqtc0-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log("Connected to PostgreSQL Database"))
    .catch((err) => {
        console.error("Database connection failed: ", err);
        process.exit(1);
    });

let otpStore = {};

app.get("/", (req, res) => {
    res.send("Server is running successfully!");
});

app.post("/send-otp", (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ message: "Phone number is required!" });
    }

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
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
        res.json({ success: false, message: "Invalid OTP! Please try again." });
    }
});

app.post("/scan-qr", async (req, res) => {
    const { serialNumber } = req.body;
    if (!serialNumber) {
        return res.status(400).json({ message: "Serial number is required!" });
    }

    try {
        const result = await pool.query("SELECT * FROM qr_codes WHERE serial_number = $1", [serialNumber]);

        if (result.rows.length === 0) {
            return res.json({ message: "QR Code not found!" });
        }

        if (result.rows[0].scanned) {
            return res.json({ message: "QR Code already scanned!" });
        }

        await pool.query(
            "UPDATE qr_codes SET scanned = TRUE, scanned_at = NOW() WHERE serial_number = $1",
            [serialNumber]
        );

        res.json({
            message: "QR Code scanned successfully!",
            download: true // Let frontend know a download is available
        });

    } catch (error) {
        console.error("Database error:", error);
        return res.status(500).json({ message: "Database error", error });
    }
});

// PDF Generation and Download
app.get("/download-pdf", (req, res) => {
    const { serialNumber } = req.query;
    if (!serialNumber) {
        return res.status(400).send("Serial number is required");
    }

    res.setHeader("Content-Disposition", `attachment; filename="QR_Scan_${serialNumber}.pdf"`);
    res.setHeader("Content-Type", "application/pdf");

    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(20).text("QR Code Scan Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Serial Number: ${serialNumber}`);
    doc.fontSize(14).text(`Scanned At: ${new Date().toLocaleString()}`);
    
    doc.end();
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});






