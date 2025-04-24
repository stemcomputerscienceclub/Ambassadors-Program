function updateReferralCounts() {
  try {
    console.log('Starting updateReferralCounts...');
    
    // Get the specific spreadsheet by ID
    const spreadsheet = SpreadsheetApp.openById('1fmmclCGfecEG7Q7oldqxWWO8yQL1QFJ5BWlAhaKv3qE');
    if (!spreadsheet) {
      console.error('Spreadsheet not found');
      return;
    }
    console.log('Spreadsheet found:', spreadsheet.getName());

    // Get all sheets in the spreadsheet
    const sheets = spreadsheet.getSheets();
    console.log('Available sheets:', sheets.map(s => s.getName()));

    // Find the form responses sheet
    let formSheet = null;
    for (const sheet of sheets) {
      const name = sheet.getName().toLowerCase();
      console.log('Checking sheet:', name);
      if (name.includes('form') || name.includes('responses')) {
        formSheet = sheet;
        break;
      }
    }

    if (!formSheet) {
      console.error('Form responses sheet not found');
      return;
    }

    console.log('Using sheet:', formSheet.getName());

    // Get the data
    const data = formSheet.getDataRange().getValues();
    console.log('Data rows:', data.length);
    console.log('First row (headers):', data[0]);

    // Skip header row
    const rows = data.slice(1);
    console.log('Sample row:', rows[0]);
    
    // Find the column with referral codes (Where did you hear about us?)
    const headers = data[0];
    const referralCodeColumn = headers.findIndex(header => 
      header.toLowerCase().includes('where did you hear about us')
    );
    
    if (referralCodeColumn === -1) {
      console.error('Referral code column not found. Headers:', headers);
      return;
    }

    console.log('Referral code column:', referralCodeColumn);
    console.log('Column header:', headers[referralCodeColumn]);
    
    // Count referrals for each code
    const referralCounts = {};
    rows.forEach((row, index) => {
      const response = row[referralCodeColumn];
      console.log(`Row ${index + 2} response:`, response);
      
      if (response) {
        // Extract STEM-CSC-XXX codes from the response
        const matches = response.match(/STEM-CSC-\d{3}/g);
        console.log(`Row ${index + 2} matches:`, matches);
        
        if (matches) {
          matches.forEach(code => {
            referralCounts[code] = (referralCounts[code] || 0) + 1;
            console.log(`Added count for ${code}:`, referralCounts[code]);
          });
        }
      }
    });

    console.log('Final referral counts:', referralCounts);

    // Convert to array and sort by count
    const referralArray = Object.entries(referralCounts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);

    console.log('Sorted referral array:', referralArray);

    // Send data in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < referralArray.length; i += BATCH_SIZE) {
      const batch = referralArray.slice(i, i + BATCH_SIZE);
      console.log(`Sending batch ${Math.floor(i/BATCH_SIZE) + 1}:`, batch);
      sendBatchToServer(batch);
    }
  } catch (error) {
    console.error('Error in updateReferralCounts:', error);
    console.error('Error stack:', error.stack);
  }
}

function sendBatchToServer(batch, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5 seconds

  try {
    console.log(`Attempting to send batch (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ referralCounts: batch }),
      muteHttpExceptions: true
    };

    console.log('Request options:', options);
    
    const SERVER_URL = 'https://ambassador.stemcsclub.org';
    console.log('Sending request to:', SERVER_URL + '/api/update-referral-counts');
    
    const response = UrlFetchApp.fetch(SERVER_URL + '/api/update-referral-counts', options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log('Response code:', responseCode);
    console.log('Response text:', responseText);
    
    if (responseCode === 200) {
      console.log('Batch processed successfully:', batch);
    } else {
      console.error('Server error for batch:', responseText);
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying batch in ${RETRY_DELAY/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
        Utilities.sleep(RETRY_DELAY);
        sendBatchToServer(batch, retryCount + 1);
      }
    }
  } catch (error) {
    console.error('Error sending batch:', error);
    console.error('Error stack:', error.stack);
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying batch in ${RETRY_DELAY/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      Utilities.sleep(RETRY_DELAY);
      sendBatchToServer(batch, retryCount + 1);
    }
  }
}

// Create a menu item to run the function manually
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Referral Tools')
    .addItem('Update Referral Counts', 'updateReferralCounts')
    .addToUi();
}

// Set up a trigger to run on form submit
function createFormSubmitTrigger() {
  // Delete any existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  // Create a new trigger to run when form is submitted
  ScriptApp.newTrigger('updateReferralCounts')
    .forSpreadsheet(SpreadsheetApp.openById('1fmmclCGfecEG7Q7oldqxWWO8yQL1QFJ5BWlAhaKv3qE'))
    .onFormSubmit()
    .create();
} 