async function run() {
    const projectId = "gen-lang-client-0746903005";
    const databaseId = "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755";
    const apiKey = "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ";
    
    const collections = ["tenants", "users"];
    
    for (const col of collections) {
        console.log(`\n=== Fetching from Firestore [${databaseId}]: ${col} ===`);
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${col}?key=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.documents) {
            console.log(`Total documents found in ${col}: ${data.documents.length}`);
            data.documents.forEach((doc, idx) => {
                const fields = doc.fields || {};
                const formattedFields = {};
                for (const [key, value] of Object.entries(fields)) {
                    formattedFields[key] = value.stringValue || value.integerValue || value.booleanValue || JSON.stringify(value);
                }
                console.log(`  [Doc #${idx + 1}]: Name: ${doc.name.split('/').pop()} | Data:`, JSON.stringify(formattedFields));
            });
        } else {
            console.log(`  No documents found or error in ${col}:`, JSON.stringify(data));
        }
    }
}

run();
