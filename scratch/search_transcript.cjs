const fs = require('fs');
const readline = require('readline');

async function run() {
    const fileStream = fs.createReadStream('C:\\Users\\CEO\\.gemini\\antigravity\\brain\\870e4bb4-c12a-4d68-b7be-2a8e876be38b\\.system_generated\\logs\\transcript.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    console.log("=== Searching transcript.jsonl for sheet read outputs ===");
    let lineNum = 0;
    for await (const line of rl) {
        lineNum++;
        if (line.includes("ccp5770@gmail.com") && line.includes("은희철")) {
            console.log(`[Line ${lineNum}] Found matching content:`);
            console.log(line);
        }
    }
}

run();
