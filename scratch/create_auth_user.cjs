const apiKey = "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ";
const email = "molnanle@gmail.com";
const password = "sangrok12345!"; // 임시 비밀번호

async function run() {
    console.log(`=== Creating User: ${email} via Firebase Auth REST API ===`);
    try {
        const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                password: password,
                returnSecureToken: true
            })
        });
        const data = await res.json();
        if (data.error) {
            console.error("Error creating user:", data.error);
        } else {
            console.log("=== User Created Successfully ===");
            console.log(`Email: ${data.email}`);
            console.log(`UID: ${data.localId}`);
            console.log(`ID Token: ${data.idToken ? "Received" : "Not Received"}`);
        }
    } catch (e) {
        console.error("Request failed:", e);
    }
}

run();
