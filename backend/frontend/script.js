let scanner;

// ✅ Send OTP Button Click
document.getElementById("sendOtpBtn").addEventListener("click", function () {
    let phone = document.getElementById("phone").value;
    let otpDisplay = document.getElementById("otpDisplay");
    let otpSection = document.getElementById("otpSection");

    if (phone.length !== 10) {
        alert("Please enter a valid 10-digit phone number.");
        return;
    }

    fetch("https://qrcodelogin-luiz.onrender.com/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
    })
    .then(res => res.json())
    .then(data => {
        otpDisplay.innerText = "OTP: " + data.otp;
        otpSection.style.display = "block";
        
        // Hide phone input after OTP is sent
        document.getElementById("phone").disabled = true;
        document.getElementById("sendOtpBtn").disabled = true;
    })
    .catch(err => {
        console.error("Error sending OTP:", err);
        alert("Failed to send OTP. Please try again.");
    });
});

// ✅ Verify OTP Button Click
document.getElementById("verifyOtpBtn").addEventListener("click", function () {
    let phone = document.getElementById("phone").value;
    let otpInput = document.getElementById("otpInput").value;
    let qrSection = document.getElementById("qrSection");

    if (!otpInput) {
        alert("Please enter the OTP");
        return;
    }

    fetch("https://qrcodelogin-luiz.onrender.com/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp: otpInput })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert("✅ OTP Verified Successfully!");
            qrSection.style.display = "block"; // Show QR section
            document.getElementById("otpSection").style.display = "none"; // Hide OTP section
        } else {
            alert("❌ Invalid OTP. Please try again.");
        }
    })
    .catch(err => {
        console.error("Error verifying OTP:", err);
        alert("OTP verification failed. Please try again.");
    });
});

// ✅ Scan QR Code Button Click
document.getElementById("scanQR").addEventListener("click", function () {
    if (!scanner) {
        scanner = new Html5QrcodeScanner("qr-video", { 
            fps: 10, 
            qrbox: 250,
            rememberLastUsedCamera: true
        });
    }

    // Show scanner and hide button
    document.getElementById("qr-video").style.display = "block";
    document.getElementById("scanQR").style.display = "none";
    document.getElementById("stopScanner").style.display = "block";

    scanner.render((decodedText) => {
        scanner.clear();
        scanner = null;
        
        // Hide scanner and show button again
        document.getElementById("qr-video").style.display = "none";
        document.getElementById("scanQR").style.display = "block";
        document.getElementById("stopScanner").style.display = "none";

        let phoneNumber = document.getElementById("phone").value;
        
        fetch("https://qrcodelogin-luiz.onrender.com/scan-qr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                serialNumber: decodedText, 
                phoneNumber: phoneNumber 
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert(`✅ ${data.message}`);
                // Optionally redirect or show success message
                window.location.href = "/success.html"; // Change this to your success page
            } else {
                alert(`❌ ${data.message}`);
                if (data.expired) {
                    alert("⚠ This QR Code has already been used!");
                }
            }
        })
        .catch(err => {
            console.error("❌ Error storing scan:", err);
            alert("Failed to process QR code. Please try again.");
        });
    }, (error) => {
        console.error("QR Scanner Error:", error);
    });
});

// ✅ Stop Scanner Button Click
document.getElementById("stopScanner").addEventListener("click", function() {
    if (scanner) {
        scanner.clear();
        scanner = null;
    }
    document.getElementById("qr-video").style.display = "none";
    document.getElementById("stopScanner").style.display = "none";
    document.getElementById("scanQR").style.display = "block";
});
