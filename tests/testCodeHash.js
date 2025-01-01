const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Define file names
const jsFiles = [
    'activation', 'amm', 'channels', 'clearing', 'clearlist', 'consensus', 'contractRegistry',
    'insurance', 'logic', 'main', 'marginMap', 'options', 'oracle', 'orderbook',
    'persistence', 'property', 'reOrg', 'tally', 'txDecoder', 'txIndex', 'types',
    'validity', 'vaults', 'vesting', 'volumeIndex'
];

// Function to hash files in the specified folder
async function hashFiles(basePath) {
    try {
        let combinedContent = ''; // Initialize empty string to hold combined file content

        // Loop through each file, read its content, and append to combinedContent
        for (const file of jsFiles) {
            const filePath = path.join(basePath, `../src/${file}.js`);

            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                combinedContent += fileContent; // Append file content
            } else {
                console.warn(`File not found: ${filePath}`); // Warn if the file is missing
            }
        }

        // Stringify the combined content
        const combinedContentString = JSON.stringify(combinedContent);

        // Generate a SHA-256 hash of the combined content
        const hash = crypto.createHash('sha256');
        hash.update(combinedContentString);
        const finalHash = hash.digest('hex');

        console.log('Final SHA-256 Hash:', finalHash);
        return finalHash;
    } catch (err) {
        console.error('Error reading or hashing files:', err);
    }
}

// Test the function
(async () => {
    const projectPath = path.resolve(__dirname);  // Specify path to the tradelayer project
    await hashFiles(projectPath);
})();
