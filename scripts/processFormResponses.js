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
    
    // Create or get the counts sheet
    let countsSheet = spreadsheet.getSheetByName('Referral Counts');
    if (!countsSheet) {
      countsSheet = spreadsheet.insertSheet('Referral Counts');
      countsSheet.appendRow(['Referral Code', 'Count']);
    }
    
    // Clear existing data except header
    if (countsSheet.getLastRow() > 1) {
      countsSheet.getRange(2, 1, countsSheet.getLastRow() - 1, 2).clear();
    }
    
    // Write new counts
    const countsData = Object.entries(referralCounts).map(([code, count]) => [code, count]);
    if (countsData.length > 0) {
      countsSheet.getRange(2, 1, countsData.length, 2).setValues(countsData);
    }
    
    // Sort by count descending
    if (countsSheet.getLastRow() > 1) {
      countsSheet.getRange(2, 1, countsSheet.getLastRow() - 1, 2).sort({column: 2, ascending: false});
    }

    // Post the counts to the server
    const payload = {
      referralCounts: Object.entries(referralCounts).map(([code, count]) => ({
        code,
        count
      }))
    };

    // Get the API key from script properties
    const scriptProperties = PropertiesService.getScriptProperties();
    const API_KEY = scriptProperties.getProperty('API_KEY');

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      headers: {
        'Authorization': 'Bearer ' + API_KEY
      }
    };

    // Replace with your actual public server URL
    const SERVER_URL = 'https://ambassador.stemcsclub.org';
    const response = UrlFetchApp.fetch(SERVER_URL + '/api/update-referral-counts', options);
    
    if (response.getResponseCode() === 200) {
      console.log('Server response:', response.getContentText());
      console.log('Referral counts updated successfully');
    } else {
      console.error('Server error:', response.getContentText());
    }
  } catch (error) {
    console.error('Error in updateReferralCounts:', error);
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

// Function to set up the API key
function setupAPIKey() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('Set API Key', 'Please enter your API key:', ui.ButtonSet.OK_CANCEL);
  
  if (response.getSelectedButton() === ui.Button.OK) {
    const API_KEY = response.getResponseText();
    PropertiesService.getScriptProperties().setProperty('API_KEY', API_KEY);
    ui.alert('API key has been set successfully!');
  }
} 