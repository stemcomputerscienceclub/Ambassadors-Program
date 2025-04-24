const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    ambassadorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    referralCode: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Referral', referralSchema); 