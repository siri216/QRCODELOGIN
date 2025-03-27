let scanner;

document.getElementById("sendOtpBtn").addEventListener("click", function () {
    let phone = document.getElementById("phone").value;
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
        document.getElementById("otpDisplay").innerText = "OTP: " + data.otp;
        document.getElementById("otpSection").style.display = "block";
    })
    .catch(err => console.error("Error sending OTP:", err));
});

document.getElementById("verifyOtpBtn").addEventListener("click", function () {
    let phone = document.getElementById("phone").value;
    let otpInput = document.getElementById("otpInput").value;
    fetch("https://qrcodelogin-luiz.onrender.com/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp: otpInput })
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
        if (data.success) {
            document.getElementById("scanQR").style.display = "block";
        }
    })
    .catch(err => console.error("Error verifying OTP:", err));
});

document.getElementById("scanQR").addEventListener("click", function () {
    if (!scanner) {
        scanner = new Html5QrcodeScanner("qr-video", { fps: 10, qrbox: 250 });
    }
    scanner.render(decodedText => {
        scanner.clear();
        scanner = null;
        let phone = document.getElementById("phone").value;
        fetch("https://qrcodelogin-luiz.onrender.com/scan-qr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serialNumber: decodedText, phone })
        })
        .then(res => res.json())
        .then(data => alert(data.message))
        .catch(err => console.error("Error storing scan:", err));
    });
});
