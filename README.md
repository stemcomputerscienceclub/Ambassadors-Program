# STME CSC Ambassadors Program

A web application for managing the CS & Tech Club's Ambassador Program with email verification (OTP) functionality and Google Sheets integration for referral tracking.

## Features

- User registration with email verification
- OTP-based email verification
- Direct email verification links
- Secure authentication using JWT
- MongoDB database integration
- Google Sheets integration for referral tracking
- Real-time ambassador rankings
- Marketing materials for ambassadors

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript (Native)
- **Backend:** Node.js, Express.js
- **Database:** MongoDB
- **Authentication:** JWT, OTP via Email
- **Email Service:** Nodemailer with Gmail
- **Form Integration:** Google Sheets API

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local installation or MongoDB Atlas account)
- Gmail account (optional for development)
- Google Cloud Project with Sheets API enabled
- Google Service Account with access to your form's spreadsheet

## Setup Instructions

1. Clone the repository:
```bash
git clone <repository-url>
cd cs-tech-ambassadors
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
   Copy `.env.example` to `.env` and update the following:

   ```env
   # Server Configuration
   PORT=3000
   JWT_SECRET=your-secret-key-here

   # MongoDB Configuration
   MONGODB_URI=mongodb://localhost:27017/cs-tech-ambassadors

   # Email Configuration (Gmail)
   EMAIL_USER=your-gmail-address
   EMAIL_PASS=your-app-specific-password

   # Google Sheets Configuration
   GOOGLE_SHEET_ID=your-sheet-id
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----"

   # Base URL
   BASE_URL=http://localhost:3000
   ```

### Google Sheets Setup

1. Create a Google Cloud Project:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select existing one
   - Enable Google Sheets API

2. Create a Service Account:
   - Go to "IAM & Admin" > "Service Accounts"
   - Click "Create Service Account"
   - Give it a name and grant "Viewer" access
   - Create and download the JSON key

3. Share your Form's Response Sheet:
   - Open your Google Form
   - Go to "Responses" tab
   - Click "View in Sheets"
   - Share the sheet with your service account email (Viewer access)
   - Copy the Sheet ID from the URL (the long string between /d/ and /edit)

4. Update .env file:
   - Set GOOGLE_SHEET_ID to your sheet ID
   - Set GOOGLE_SERVICE_ACCOUNT_EMAIL from the JSON key
   - Set GOOGLE_PRIVATE_KEY from the JSON key

### Email Configuration

#### Development Mode (No Email Required)
- If `EMAIL_USER` and `EMAIL_PASS` are not set in `.env`, the system will:
  - Log OTP codes to the console
  - Display verification URLs in the console
  - Allow testing without email setup

#### Production Mode (Email Required)
To enable email sending:
1. Use a Gmail account
2. Enable 2-Step Verification
3. Generate an App Password and use it as `EMAIL_PASS`

## Running the Application

### Development Mode
```bash
npm run dev
```
- Server will run on http://localhost:3000
- OTP codes will be logged to console if email is not configured
- Referral counts will update automatically from Google Sheet

### Production Mode
```bash
npm start
```
- Ensure email configuration is set up
- Set NODE_ENV=production in .env

## Referral Tracking

The system automatically tracks referrals by:
1. Reading form responses from Google Sheet
2. Updating referral counts hourly
3. Maintaining ambassador rankings
4. Showing real-time statistics

### Manual Update
To manually trigger a referral count update:
```bash
curl -X POST http://localhost:3000/api/debug/test-form
```

## Project Structure

```
cs-tech-ambassadors/
├── public/              # Static files
│   ├── images/         # Image assets
│   ├── styles.css      # Global styles
│   ├── dashboard.css   # Dashboard styles
│   ├── index.html      # Login page
│   ├── signup.html     # Registration page
│   ├── verify.html     # OTP verification page
│   └── dashboard.html  # User dashboard
├── server.js           # Express server and API endpoints
├── package.json        # Project dependencies
└── .env               # Environment variables
```

## Security Features

- Password hashing using bcrypt
- JWT-based authentication
- Email verification using OTP
- MongoDB for secure data storage
- CORS enabled
- Environment variables for sensitive data
- Secure Google Sheets API integration

## Development Notes

- Referral counts update every hour automatically
- Manual updates available through debug endpoint
- Console logging for development troubleshooting
- Google Sheets integration for reliable form response tracking

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
