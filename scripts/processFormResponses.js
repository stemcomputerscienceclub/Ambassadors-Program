const { google } = require('googleapis');
const axios = require('axios');

// Initialize Google Sheets API
const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

async function processFormResponses() {
    try {
        // Get the latest responses from Google Sheets
        const response = await sheets.spreadsheets.values.get({
            auth,
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Form Responses 1!A:Z' // Adjust range as needed
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return; // Skip if no data or only headers

        // Process each response
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const email = row[1]; // Adjust index based on your form structure
            const referralCode = row[2]; // Adjust index based on your form structure

            if (!email || !referralCode) continue;

            try {
                // Track the referral
                await axios.post('http://localhost:3000/api/track-referral', {
                    email,
                    referralCode
                });
            } catch (error) {
                console.error(`Error processing response for ${email}:`, error.message);
            }
        }
    } catch (error) {
        console.error('Error processing form responses:', error);
    }
}

// Run the process every hour
setInterval(processFormResponses, 3600000);

// Initial run
processFormResponses(); 