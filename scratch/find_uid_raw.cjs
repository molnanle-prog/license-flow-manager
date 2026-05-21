const apiKey = "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ";
const email = "molnanle@gmail.com";

async function run() {
    console.log(`=== Querying Raw Accounts Lookup for: ${email} ===`);
    try {
        const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: [email] })
        });
        const data = await res.json();
        console.log("Raw Response Data:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Query failed:", e);
    }
}

run();
