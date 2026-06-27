const mongoose = require('mongoose');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const uri = 'mongodb+srv://rentacarapp:rentacarapp123@cluster0.oledrkn.mongodb.net/rentacar?retryWrites=true&w=majority';

const UserSchema = new mongoose.Schema({
  cin: String,
  role: String
}, { collection: 'users' }); // Check 'users' collection

const User = mongoose.model('User', UserSchema);

async function check() {
  try {
    await mongoose.connect(uri);
    const users = await User.find({}).lean();
    console.log('--- USERS IN DB ---');
    console.log(users);
    console.log('-------------------');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
