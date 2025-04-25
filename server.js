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

// MongoDB Connection with improved configuration
const MONGODB_URI = process.env.MONGODB_URI;

const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 60000, // Increased from 30000
  socketTimeoutMS: 90000, // Increased from 45000
  family: 4,
  retryWrites: true,
  retryReads: true,
  maxPoolSize: 100, // Increased from 50
  minPoolSize: 20, // Increased from 10
  connectTimeoutMS: 60000, // Increased from 30000
  heartbeatFrequencyMS: 5000, // Decreased for more frequent checks
  waitQueueTimeoutMS: 60000, // Increased from 30000
  keepAlive: true,
  keepAliveInitialDelay: 300000,
  maxIdleTimeMS: 300000, // Increased from 120000
  autoIndex: true,
  autoCreate: true,
  bufferCommands: true, // Explicitly enable command buffering
  bufferTimeoutMS: 30000 // Set buffer timeout to 30 seconds
};

// Add connection event handlers with more detailed logging
mongoose.connection.on('connected', () => {
  console.log('MongoDB connected successfully');
  console.log('Connection pool size:', mongoose.connection.client.s.options.maxPoolSize);
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  console.error('Full error details:', JSON.stringify(err, null, 2));
  
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

// Add monitoring for slow operations
mongoose.set('debug', {
  color: true,
  shell: true,
  slowMs: 100 // Log operations that take longer than 100ms
});

// Function to connect to MongoDB with improved retry logic
async function connectWithRetry() {
  let retries = 10; // Increased from 5
  let delay = 1000;

  while (retries > 0) {
    try {
      console.log(`Attempting to connect to MongoDB (${retries} retries left)...`);
      await mongoose.connect(MONGODB_URI, mongooseOptions);
      console.log('Successfully connected to MongoDB');
      
      // Set up keepalive on the connection
      mongoose.connection.db.admin().ping(function(err, result) {
        if (err || !result) {
          console.error('MongoDB ping failed:', err || 'No result');
        } else {
          console.log('MongoDB ping successful');
        }
      });
      
      return;
    } catch (err) {
      console.error(`MongoDB connection error (${retries} retries left):`, err);
      console.error('Error details:', {
        name: err.name,
        message: err.message,
        code: err.code,
        stack: err.stack
      });
      
      retries--;
      
      if (retries === 0) {
        console.error('Failed to connect to MongoDB after all retries');
        if (process.env.NODE_ENV !== 'production') {
          process.exit(1);
        }
        return;
      }

      delay *= 2; // Exponential backoff
      console.log(`Waiting ${delay}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, delay));
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
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  verified: { type: Boolean, default: false },
  referralCode: { type: String, unique: true },
  referralCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  verificationToken: { type: String },
  otp: { type: String },
  otpExpiresAt: { type: Date }
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

// Email transporter setup with better error handling and rate limiting
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  pool: true, // Enable connection pooling
  maxConnections: 5, // Maximum number of connections in the pool
  maxMessages: 100, // Maximum number of messages per connection
  rateDelta: 1000, // Time in ms between messages
  rateLimit: 5, // Maximum number of messages per rateDelta
  tls: {
    rejectUnauthorized: false // For development only
  }
});

// Email sending queue to handle rate limits
const emailQueue = [];
let isProcessingQueue = false;

async function processEmailQueue() {
  if (isProcessingQueue || emailQueue.length === 0) return;
  
  isProcessingQueue = true;
  try {
    while (emailQueue.length > 0) {
      const { mailOptions, resolve, reject } = emailQueue.shift();
      try {
        await transporter.sendMail(mailOptions);
        resolve();
      } catch (error) {
        if (error.code === 'EENVELOPE' || error.code === 'EAUTH') {
          // Critical error, reject immediately
          reject(error);
        } else {
          // Rate limit or temporary error, retry after delay
          emailQueue.push({ mailOptions, resolve, reject });
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

// Function to send email with rate limiting
async function sendEmail(mailOptions) {
  return new Promise((resolve, reject) => {
    emailQueue.push({ mailOptions, resolve, reject });
    processEmailQueue();
  });
}

// Verify email configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('Email configuration error:', error);
    if (error.code === 'EAUTH') {
      console.error('Authentication failed. Please check your email credentials.');
    } else if (error.code === 'ECONNECTION') {
      console.error('Connection to email server failed. Please check your internet connection.');
    }
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Generate OTP
function generateOTP() {
    return Math.floor(10000 + Math.random() * 90000).toString(); // 5-digit OTP
}

// Generate verification token
function generateVerificationToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Function to generate the next referral code
async function generateNextReferralCode() {
    try {
        // Find the highest existing referral code number
        const lastUser = await User.findOne({ referralCode: { $regex: /^STEM-CSC-\d{3}$/ } })
            .sort({ referralCode: -1 });
        
        let nextNumber = 1;
        
        if (lastUser && lastUser.referralCode) {
            const lastNumber = parseInt(lastUser.referralCode.split('-')[2]);
            if (!isNaN(lastNumber)) {
                nextNumber = lastNumber + 1;
            }
        }
        
        // Format the number with leading zeros
        const formattedNumber = nextNumber.toString().padStart(3, '0');
        return `STEM-CSC-${formattedNumber}`;
    } catch (error) {
        console.error('Error generating referral code:', error);
        throw error;
    }
}

// Register new user with better error handling
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Validate inputs
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Validate email format
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) || email.includes('..')) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate password
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    // Check if user already exists
    let existingUser;
    try {
      existingUser = await User.findOne({ email })
        .maxTimeMS(30000)
        .lean()
        .exec();
    } catch (err) {
      console.error('Error checking for existing user:', err);
      return res.status(503).json({ message: 'Database connection error. Please try again.' });
    }

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification token and OTP
    const verificationToken = generateVerificationToken();
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create new user with a temporary referral code
    const user = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      verificationToken,
      otp,
      otpExpiresAt: expiresAt,
      referralCode: `TEMP-${Date.now()}` // Temporary unique code
    });

    await user.save();

    // Send verification email
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Verify your email for CS & Tech Ambassadors Program',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #4a90e2;">Welcome to CS & Tech Ambassadors Program!</h1>
                <p>Hello ${user.name},</p>
                <p>Your verification code is:</p>
                
                <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 10px;">
                    <h2 style="color: #4a90e2; font-size: 2.5rem; letter-spacing: 5px; margin: 0;">${otp}</h2>
                    <p style="color: #666; margin-top: 10px;">This code will expire in 15 minutes</p>
                </div>

                <p>Click the button below to verify your email address:</p>
                <div style="text-align: center; margin: 20px 0;">
                    <a href="https://ambassador.stemcsclub.org/verify.html?token=${verificationToken}" 
                       style="background-color: #4a90e2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                        Verify Email Address
                    </a>
                </div>
                <p>If the button above doesn't work, you can also copy and paste this link into your browser:</p>
                <p style="word-break: break-all;">https://ambassador.stemcsclub.org/verify.html?token=${verificationToken}</p>
                <p>Best regards,<br>CS & Tech Ambassadors Team</p>
            </div>
        `
    };

    try {
      // Send verification email with rate limiting
      await sendEmail(mailOptions);
      res.status(201).json({
        message: 'Registration successful. Please check your email for verification.',
        verificationToken
      });
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      await User.deleteOne({ email });
      
      if (emailError.code === 'EENVELOPE') {
        return res.status(400).json({ message: 'Invalid email address. Please check your email and try again.' });
      } else if (emailError.code === 'EAUTH') {
        return res.status(500).json({ message: 'Email service authentication failed. Please try again later.' });
      } else if (emailError.code === 'ECONNECTION') {
        return res.status(503).json({ message: 'Email service is temporarily unavailable. Please try again later.' });
      } else {
        return res.status(500).json({ message: 'Failed to send verification email. Please try again later.' });
      }
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify email with token
app.post('/api/verify', async (req, res) => {
    try {
        const { code, token } = req.body;
        console.log('Received verification request:', { code, token }); // Debug log

        if (!token) {
            console.error('Verification failed: No token provided');
            return res.status(400).json({ message: 'Verification token is required' });
        }

        // Find user with matching token
        const user = await User.findOne({ verificationToken: token });
        console.log('Found user:', user ? { email: user.email, verified: user.verified } : 'Not found'); // Debug log
        
        if (!user) {
            console.error('Verification failed: Invalid token', token);
            return res.status(400).json({ message: 'Invalid or expired verification token' });
        }

        // Verify OTP
        if (user.otp !== code) {
            console.error('Verification failed: Invalid OTP for user', user.email);
            return res.status(400).json({ message: 'Invalid verification code' });
        }
        
        if (user.otpExpiresAt < new Date()) {
            console.error('Verification failed: Expired OTP for user', user.email);
            return res.status(400).json({ message: 'Verification code has expired' });
        }

        // Generate final referral code
        const referralCode = await generateNextReferralCode();
        console.log('Generated referral code:', referralCode); // Debug log

        // Update user
        user.verified = true;
        user.referralCode = referralCode;
        user.verificationToken = undefined;
        user.otp = undefined;
        user.otpExpiresAt = undefined;
        
        try {
            await user.save();
            console.log('User verified successfully:', user.email);
        } catch (saveError) {
            console.error('Error saving user after verification:', saveError);
            return res.status(500).json({ message: 'Error completing verification. Please try again.' });
        }

        // Generate JWT token
        const authToken = jwt.sign(
            { email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Email verified successfully',
            token: authToken
        });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ message: 'An error occurred during verification. Please try again later.' });
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

// Dashboard data endpoint
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get leaderboard data
    const leaderboard = await User.find({ verified: true })
      .sort({ referralCount: -1 })
      .limit(10)
      .select('name referralCount');

    // Calculate user's rank
    const userRank = await User.countDocuments({
      verified: true,
      referralCount: { $gt: user.referralCount }
    }) + 1;

    // Get total ambassadors count
    const totalAmbassadors = await User.countDocuments({ verified: true });

    res.json({
      name: user.name,
      rank: userRank,
      referrals: user.referralCount,
      totalAmbassadors,
      referralCode: user.referralCode,
      leaderboard: leaderboard.map(user => ({
        name: user.name,
        referrals: user.referralCount
      }))
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Marketing materials endpoint
app.get('/api/materials', authenticateToken, async (req, res) => {
  try {
    const materials = {
      general: [
        {
          id: 'banner1',
          title: 'Club Banner',
          type: 'image',
          url: '/images/marketing/banner1.jpg'
        },
        {
          id: 'logo',
          title: 'Club Logo',
          type: 'image',
          url: '/images/marketing/logo.png'
        }
      ],
      tracks: [
        {
          id: 'web-dev',
          title: 'Web Development Track',
          type: 'image',
          url: '/images/marketing/web-dev.jpg'
        },
        {
          id: 'ai-ml',
          title: 'AI & ML Track',
          type: 'image',
          url: '/images/marketing/ai-ml.jpg'
        }
      ],
      registration: [
        {
          id: 'registration-guide',
          title: 'Registration Guide',
          type: 'image',
          url: '/images/marketing/registration-guide.jpg'
        }
      ],
      faq: [
        {
          id: 'faq-guide',
          title: 'FAQ Guide',
          type: 'image',
          url: '/images/marketing/faq-guide.jpg'
        }
      ]
    };

    res.json(materials);
  } catch (error) {
    console.error('Materials error:', error);
    res.status(500).json({ error: 'Failed to fetch marketing materials' });
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

// Update the referral counts endpoint with better error handling
app.post('/api/update-referral-counts', async (req, res) => {
  console.log('Received request to update referral counts');
  console.log('Request body:', req.body);
  
  try {
    const { referralCounts } = req.body;
    
    if (!referralCounts || !Array.isArray(referralCounts)) {
      console.error('Invalid referral counts data:', referralCounts);
      return res.status(400).json({ message: 'Invalid referral counts data' });
    }

    console.log('Processing referral counts batch:', referralCounts);

    // Process each referral count with a timeout and retry
    const results = await Promise.all(referralCounts.map(async ({ code, count }) => {
      console.log(`Processing referral code ${code} with count ${count}`);
      let retries = 3;
      let lastError = null;

      while (retries > 0) {
        try {
          const startTime = Date.now();
          const result = await User.updateOne(
            { referralCode: code },
            { $set: { referralCount: count } },
            { maxTimeMS: 30000 } // Increased timeout
          );
          const endTime = Date.now();
          console.log(`Update for ${code} completed in ${endTime - startTime}ms`);
          console.log(`Update result for ${code}:`, result);
          return { code, success: true, modified: result.modifiedCount };
        } catch (error) {
          console.error(`Error updating ${code} (${retries} retries left):`, error);
          lastError = error;
          retries--;
          
          if (retries > 0) {
            const delay = Math.pow(2, 3 - retries) * 1000; // Exponential backoff
            console.log(`Waiting ${delay}ms before retrying...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      return { 
        code, 
        success: false, 
        error: lastError?.message || 'Unknown error',
        stack: lastError?.stack
      };
    }));

    // Check for any failures
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      console.error('Some updates failed:', failures);
      return res.status(207).json({ 
        message: 'Some updates failed',
        results,
        failures
      });
    }

    // Update last update time
    lastUpdateTime = new Date();
    console.log('All updates completed successfully at:', lastUpdateTime);

    res.json({ 
      message: 'Referral counts updated successfully',
      timestamp: lastUpdateTime,
      results
    });
  } catch (error) {
    console.error('Error updating referral counts:', error);
    console.error('Error stack:', error.stack);
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
