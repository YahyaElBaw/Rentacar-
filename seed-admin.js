const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Use the same verified URI from .env
const uri = 'mongodb+srv://rentacarapp:rentacarapp123@cluster0.oledrkn.mongodb.net/rentacar?retryWrites=true&w=majority';

// Define User Schema for Seeding
const UserSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  cin: String,
  phone: String,
  password: String,
  role: String,
  photos: [String]
});

const User = mongoose.model('User', UserSchema);

async function seed() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    
    const adminCin = 'ADMIN001';
    const adminPhone = '0600000000';
    
    const existing = await User.findOne({ cin: adminCin });
    if (existing) {
      console.log('Admin already exists!');
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPhone, salt);

    const admin = new User({
      firstName: 'System',
      lastName: 'Admin',
      cin: adminCin,
      phone: adminPhone,
      password: hashedPassword,
      role: 'admin',
      photos: []
    });

    await admin.save();
    console.log('--------------------------------------------------');
    console.log('✅ Admin User Created Successfully!');
    console.log(`Login (CIN): ${adminCin}`);
    console.log(`Password (Phone): ${adminPhone}`);
    console.log('--------------------------------------------------');
    
    process.exit(0);
  } catch (err) {
    console.error('Error seeding admin:', err);
    process.exit(1);
  }
}

seed();
