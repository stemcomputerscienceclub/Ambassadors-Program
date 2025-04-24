function updateReferralCounts() {
  try {
    // Get the specific spreadsheet by ID
    const spreadsheet = SpreadsheetApp.openById('1fmmclCGfecEG7Q7oldqxWWO8yQL1QFJ5BWlAhaKv3qE');
    if (!spreadsheet) {
      console.error('Spreadsheet not found');
      return;
    }

    // Get all sheets in the spreadsheet
    const sheets = spreadsheet.getSheets();
    console.log('Available sheets:', sheets.map(s => s.getName()));

    // Find the form responses sheet
    let formSheet = null;
    for (const sheet of sheets) {
      const name = sheet.getName().toLowerCase();
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

    // Skip header row
    const rows = data.slice(1);
    
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
    
    // Count referrals for each code
    const referralCounts = {};
    rows.forEach(row => {
      const response = row[referralCodeColumn];
      if (response) {
        // Extract STEM-CSC-XXX codes from the response
        const matches = response.match(/STEM-CSC-\d{3}/g);
        if (matches) {
          matches.forEach(code => {
            referralCounts[code] = (referralCounts[code] || 0) + 1;
          });
        }
      }
    });

    console.log('Referral counts:', referralCounts);

    // Convert to array and sort by count
    const referralArray = Object.entries(referralCounts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);

    // Send data in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < referralArray.length; i += BATCH_SIZE) {
      const batch = referralArray.slice(i, i + BATCH_SIZE);
      sendBatchToServer(batch);
    }
  } catch (error) {
    console.error('Error in updateReferralCounts:', error);
  }
}

function sendBatchToServer(batch, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5 seconds

  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ referralCounts: batch }),
      muteHttpExceptions: true
    };

    const SERVER_URL = 'https://ambassador.stemcsclub.org';
    const response = UrlFetchApp.fetch(SERVER_URL + '/api/update-referral-counts', options);
    
    if (response.getResponseCode() === 200) {
      console.log('Batch processed successfully:', batch);
    } else {
      console.error('Server error for batch:', response.getContentText());
      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying batch in ${RETRY_DELAY/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
        Utilities.sleep(RETRY_DELAY);
        sendBatchToServer(batch, retryCount + 1);
      }
    }
  } catch (error) {
    console.error('Error sending batch:', error);
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