require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();

// Middleware
app.use(cors({
    origin: ["https://qrcodelogin-1-mldp.onrender.com", "http://localhost:3000"]
}));
app.use(bodyParser.json());

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_k5PVEWXApj9L@ep-wild-sunset-a53nlyyu-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ssl: {
        rejectUnauthorized: false
    }
});

// OTP Storage (in-memory for demo)
const otpStore = {};

// Routes
app.get('/', (req, res) => {
    res.send('QR Code Login API');
});

// Send OTP
app.post('/send-otp', (req, res) => {
    const { phone } = req.body;

    if (!phone || phone.length !== 10) {
        return res.status(400).json({ 
            success: false, 
            message: 'Valid 10-digit phone number required' 
        });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[phone] = {
        otp,
        createdAt: new Date()
    };

    console.log(`OTP for ${phone}: ${otp}`); // For debugging
    res.json({ success: true, otp });
});

// Verify OTP
app.post('/verify-otp', (req, res) => {
    const { phone, otp } = req.body;

    if (!otpStore[phone]) {
        return res.json({ 
            success: false, 
            message: 'OTP expired or not generated' 
        });
    }

    // Check if OTP is expired (5 minutes)
    const otpAge = (new Date() - new Date(otpStore[phone].createdAt)) / 1000 / 60;
    if (otpAge > 5) {
        delete otpStore[phone];
        return res.json({ 
            success: false, 
            message: 'OTP expired. Please request a new one.' 
        });
    }

    if (otpStore[phone].otp === otp) {
        delete otpStore[phone];
        res.json({ 
            success: true, 
            message: 'OTP verified successfully!' 
        });
    } else {
        res.json({ 
            success: false, 
            message: 'Invalid OTP. Please try again.' 
        });
    }
});

// Scan QR Code
app.post('/scan-qr', async (req, res) => {
    const { serialNumber, phoneNumber } = req.body;

    if (!serialNumber || !phoneNumber) {
        return res.status(400).json({ 
            success: false, 
            message: 'Both serial number and phone number are required' 
        });
    }

    try {
        // Check if QR code exists
        const qrCheck = await pool.query(
            'SELECT * FROM qr_codes WHERE serial_number = $1',
            [serialNumber]
        );

        if (qrCheck.rows.length === 0) {
            return res.json({ 
                success: false, 
                message: 'QR code not found' 
            });
        }

        // Check if already scanned
        if (qrCheck.rows[0].scanned) {
            return res.json({ 
                success: false, 
                message: 'This QR code has already been scanned',
                scannedAt: qrCheck.rows[0].scanned_at
            });
        }

        // Update QR code record
        const result = await pool.query(
            `UPDATE qr_codes 
             SET phone_number = $1, scanned = TRUE, scanned_at = NOW() 
             WHERE serial_number = $2
             RETURNING *`,
            [phoneNumber, serialNumber]
        );

        res.json({ 
            success: true,
            message: 'QR code scanned successfully',
            scanData: result.rows[0]
        });
    } catch (error) {
        console.error('Scan error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing QR scan',
            error: error.message 
        });
    }
});

// Get scan history
app.get('/scans/:phoneNumber', async (req, res) => {
    const { phoneNumber } = req.params;

    try {
        const result = await pool.query(
            `SELECT serial_number, scanned_at 
             FROM qr_codes 
             WHERE phone_number = $1
             ORDER BY scanned_at DESC`,
            [phoneNumber]
        );

        res.json({ 
            success: true,
            scans: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('Error fetching scans:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', async () => {
    await pool.end();
    process.exit();
});
