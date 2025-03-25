document.getElementById("scanQR").addEventListener("click", function () {
    let scanner = new Html5QrcodeScanner("qr-video", { fps: 10, qrbox: 250 });

    scanner.render((decodedText) => {
        scanner.clear();
        console.log("Scanned QR Code:", decodedText);

        // Send scanned serial number to backend
        fetch("https://qrcodelogin-1.onrender.com/fetch-user-details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serialNumber: decodedText })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert("User details fetched successfully!");

                // Show "Download PDF" button
                document.getElementById("downloadPDF").style.display = "block";
                document.getElementById("downloadPDF").setAttribute("data-user-id", data.userId);
            } else {
                alert("Failed to fetch user details.");
            }
        })
        .catch(error => {
            console.error("Error fetching user details:", error);
            alert("An error occurred while fetching user details.");
        });

    }, (errorMessage) => {
        console.error("QR Scanner Error:", errorMessage);
        alert("QR Code scanning failed.");
    });
});

// Download PDF when the button is clicked
document.getElementById("downloadPDF").addEventListener("click", function () {
    let userId = this.getAttribute("data-user-id");

    fetch(`https://qrcodelogin-1.onrender.com/download-pdf?userId=${userId}`, {
        method: "GET"
    })
    .then(response => response.blob())
    .then(blob => {
        let link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "UserDetails.pdf";
        link.click();
    })
    .catch(error => {
        console.error("Error downloading PDF:", error);
        alert("Failed to download the PDF.");
    });
});


