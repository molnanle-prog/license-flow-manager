const apiKey = "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ";
const emails = ["molnanle@gmail.com", "ccp5770@gmail.com"];

async function run() {
    console.log("=== Querying Firebase Authentication REST API for UIDs ===");
    for (const email of emails) {
        try {
            const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: [email] })
            });
            const data = await res.json();
            if (data.users && data.users.length > 0) {
                const user = data.users[0];
                console.log(`Email: ${email} -> UID: ${user.localId} (Created: ${new Date(parseInt(user.createdAt)).toISOString()})`);
            } else {
                console.log(`Email: ${email} -> Not found in Firebase Authentication`);
            }
        } catch (e) {
            console.error(`Error querying email ${email}:`, e);
        }
    }
}

run();
