import { MongoClient } from 'mongodb';

async function checkUsers() {
  const uri = "mongodb+srv://rentacarapp:rentacarapp123@cluster0.oledrkn.mongodb.net/rentacar?retryWrites=true&w=majority";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('rentacar');
    const users = await db.collection('users').find({}).toArray();
    
    console.log('--- ADMIN USERS IN DATABASE ---');
    users.forEach(u => {
      console.log(`CIN: ${u.cin}, Name: ${u.firstName} ${u.lastName}, Role: ${u.role}`);
    });
    console.log('-------------------------------');
  } finally {
    await client.close();
  }
}

checkUsers().catch(console.error);
