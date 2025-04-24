import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config();

const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-vercel-domain.vercel.app'] // Replace with your Vercel domain
    : 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Load google credentials from file
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';

let googleAuth;
let sheets;
try {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    googleAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheets = google.sheets({ version: 'v4', auth: googleAuth });
    console.log('Google API credentials loaded from:', CREDENTIALS_PATH);
  } else {
    console.log('Google API credentials file not found. Google Sheets integration will be disabled.');
    googleAuth = null;
    sheets = null;
  }
} catch (error) {
  console.error('Failed to load Google API credentials:', error.message);
  googleAuth = null;
  sheets = null;
}

// Initialize update tracking
let lastUpdateTime = new Date();
const UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

// MongoDB Connection with better configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://CSC:w52srmPwuXPr8Fj3@cluster0.nvcjru6.mongodb.net/ambassadors?retryWrites=true&w=majority&appName=Cluster0';

const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  family: 4,
  retryWrites: true,
  retryReads: true,
  maxPoolSize: 50,
  minPoolSize: 10,
  connectTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,
  serverSelectionTryOnce: false,
  waitQueueTimeoutMS: 30000,
  keepAlive: true,
  keepAliveInitialDelay: 300000
};

// Add connection event handlers
mongoose.connection.on('connected', () => {
  console.log('MongoDB connected successfully');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  if (err.name === 'MongooseServerSelectionError') {
    console.error('\nIMPORTANT: MongoDB Atlas IP Whitelist Issue');
    console.error('Please add the following IP ranges to your MongoDB Atlas whitelist:');
    console.error('1. Go to MongoDB Atlas Dashboard');
    console.error('2. Click on "Network Access"');
    console.error('3. Click "Add IP Address"');
    console.error('4. Add these Vercel IP ranges:');
    console.error('   - 76.76.21.0/24');
    console.error('   - 76.76.22.0/24');
    console.error('   - 76.76.23.0/24');
    console.error('5. Click "Confirm"');
  }
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// Function to connect to MongoDB with retry
async function connectWithRetry() {
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(MONGODB_URI, mongooseOptions);
      console.log('Successfully connected to MongoDB');
      return;
    } catch (err) {
      console.error(`MongoDB connection error (${retries} retries left):`, err);
      retries--;
      if (retries === 0) {
        console.error('Failed to connect to MongoDB after all retries');
        if (process.env.NODE_ENV !== 'production') {
          process.exit(1);
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Connect to MongoDB
connectWithRetry().catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// MongoDB Models
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  verified: { type: Boolean, default: false },
  referralCode: { type: String, unique: true },
  referralCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  verificationToken: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const OTP = mongoose.model('OTP', otpSchema);

// Email transporter setup with better error handling
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false // For development only
  }
});

// Verify email configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('Email configuration error:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate verification token
function generateVerificationToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Register new user with better error handling
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email format
    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) || email.includes('..')) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate password
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    // Check if user already exists with retry
    let existingUser;
    try {
      existingUser = await User.findOne({ email }).maxTimeMS(30000);
    } catch (err) {
      console.error('Error checking for existing user:', err);
      if (err.name === 'MongooseServerSelectionError') {
        return res.status(503).json({ 
          message: 'Database connection error. Please try again later.',
          error: 'IP whitelist issue detected'
        });
      }
      return res.status(503).json({ message: 'Database connection error. Please try again.' });
    }

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user without referral code
    const user = new User({
      email,
      password: hashedPassword
    });

    await user.save();

    // Generate OTP
    const otp = generateOTP();
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Save OTP
    const otpRecord = new OTP({
      email,
      otp,
      verificationToken,
      expiresAt
    });

    await otpRecord.save();

    try {
      // Send verification email
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Verify your email for CS & Tech Ambassadors Program',
        html: `
          <h1>Welcome to CS & Tech Ambassadors Program!</h1>
          <p>Your verification code is: <strong>${otp}</strong></p>
          <p>This code will expire in 15 minutes.</p>
        `
      };

      await transporter.sendMail(mailOptions);
      res.status(201).json({
        message: 'Registration successful. Please check your email for verification.',
        verificationToken
      });
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // If email fails, delete the user and OTP records
      await User.deleteOne({ email });
      await OTP.deleteOne({ email });
      return res.status(500).json({ message: 'Failed to send verification email. Please try again.' });
    }
  } catch (error) {
    console.error('Registration error:', error);
    if (error.name === 'MongooseError' && error.message.includes('buffering timed out')) {
      res.status(503).json({ message: 'Database connection timed out. Please try again.' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp, verificationToken } = req.body;

    // Find OTP record
    const otpRecord = await OTP.findOne({
      email,
      verificationToken,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Generate unique referral code
    const userReferralCode = `STEM-CSC-${Math.floor(100 + Math.random() * 900)}`;

    // Update user verification status and add referral code
    await User.updateOne(
      { email },
      { 
        verified: true,
        referralCode: userReferralCode
      }
    );

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate JWT token
    const token = jwt.sign(
      { email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Email verified successfully',
      token,
      referralCode: userReferralCode
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check if email is verified
    if (!user.verified) {
      return res.status(400).json({ message: 'Please verify your email first' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        email: user.email,
        referralCode: user.referralCode,
        referralCount: user.referralCount
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Protected route middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Get user dashboard data
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get all verified users for leaderboard
    const allUsers = await User.find({ verified: true })
      .sort({ referralCount: -1 })
      .select('email referralCode referralCount');

    // Find user's rank
    const userRank = allUsers.findIndex(u => u.email === user.email) + 1;

    res.json({
      email: user.email,
      referralCode: user.referralCode,
      referralCount: user.referralCount,
      rank: userRank,
      totalAmbassadors: allUsers.length,
      lastUpdate: lastUpdateTime,
      timeUntilUpdate: UPDATE_INTERVAL - (Date.now() - lastUpdateTime.getTime()),
      topAmbassadors: allUsers.slice(0, 10) // Top 10 ambassadors
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Function to update referral counts from Google Forms
async function updateReferralCounts() {
    if (!sheets) {
        console.log('Google Sheets API not available - skipping referral count update');
        return;
    }

    try {
        // Get all responses from Google Sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Form Responses 1!A:Z'
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return;

        // Find the column with referral codes
        const headers = rows[0];
        const referralCodeColumn = headers.findIndex(header => 
            header.toLowerCase().includes('where did you hear about us')
        );

        if (referralCodeColumn === -1) {
            console.log('Referral code column not found in form responses');
            return;
        }

        // Count referrals for each code
        const referralCounts = {};
        for (let i = 1; i < rows.length; i++) {
            const response = rows[i][referralCodeColumn];
            if (response) {
                // Extract STEM-CSC-XXX codes from the response
                const matches = response.match(/STEM-CSC-\d{3}/g);
                if (matches) {
                    matches.forEach(code => {
                        referralCounts[code] = (referralCounts[code] || 0) + 1;
                    });
                }
            }
        }

        // Update user counts
        const users = await User.find({});
        for (const user of users) {
            if (user.referralCode && referralCounts[user.referralCode]) {
                user.referralCount = referralCounts[user.referralCode];
                await user.save();
            }
        }

        console.log('Referral counts updated successfully');
    } catch (error) {
        console.error('Error updating referral counts:', error);
    }
}

// Update counts every hour
setInterval(updateReferralCounts, 3600000);

// Initial update
updateReferralCounts();

// Track referrals from Google Forms
app.post('/api/track-referral', async (req, res) => {
    try {
        const { email, referralCode } = req.body;

        // Validate input
        if (!email || !referralCode) {
            return res.status(400).json({ message: 'Email and referral code are required' });
        }

        // Find the ambassador who referred this user
        const ambassador = await User.findOne({ referralCode });
        if (!ambassador) {
            return res.status(404).json({ message: 'Invalid referral code' });
        }

        // Check if this email has already been referred
        const existingReferral = await Referral.findOne({ email });
        if (existingReferral) {
            return res.status(400).json({ message: 'This email has already been referred' });
        }

        // Create new referral record
        const referral = new Referral({
            email,
            ambassadorId: ambassador._id,
            referralCode,
            timestamp: new Date()
        });

        await referral.save();

        // Update ambassador's referral count
        ambassador.referralCount = (ambassador.referralCount || 0) + 1;
        await ambassador.save();

        res.status(201).json({ message: 'Referral tracked successfully' });
    } catch (error) {
        console.error('Error tracking referral:', error);
        res.status(500).json({ message: 'Error tracking referral' });
    }
});

// Get referral statistics
app.get('/api/referral-stats', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const ambassador = await User.findById(decoded.userId);

        if (!ambassador) {
            return res.status(404).json({ message: 'Ambassador not found' });
        }

        // Get all referrals for this ambassador
        const referrals = await Referral.find({ ambassadorId: ambassador._id })
            .sort({ timestamp: -1 });

        // Get total number of ambassadors and current rank
        const totalAmbassadors = await User.countDocuments();
        const ambassadors = await User.find().sort({ referralCount: -1 });
        const rank = ambassadors.findIndex(a => a._id.toString() === ambassador._id.toString()) + 1;

        res.json({
            referralCount: ambassador.referralCount || 0,
            referrals,
            rank,
            totalAmbassadors
        });
    } catch (error) {
        console.error('Error getting referral stats:', error);
        res.status(500).json({ message: 'Error getting referral stats' });
    }
});

// Endpoint to receive referral counts from Google Apps Script
app.post('/api/update-referral-counts', async (req, res) => {
    try {
        const { referralCounts } = req.body;
        
        if (!referralCounts || !Array.isArray(referralCounts)) {
            return res.status(400).json({ message: 'Invalid referral counts data' });
        }

        console.log('Received referral counts:', referralCounts);

        // Update referral counts in the database
        for (const { code, count } of referralCounts) {
            const result = await User.updateOne(
                { referralCode: code },
                { $set: { referralCount: count } }
            );
            console.log(`Updated ${code}: ${result.modifiedCount} documents modified`);
        }

        // Update last update time
        lastUpdateTime = new Date();

        res.json({ 
            message: 'Referral counts updated successfully',
            timestamp: lastUpdateTime
        });
    } catch (error) {
        console.error('Error updating referral counts:', error);
        res.status(500).json({ 
            message: 'Failed to update referral counts',
            error: error.message 
        });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
