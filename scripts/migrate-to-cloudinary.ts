import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';

config({ path: resolve(process.cwd(), '.env') });

const cloudinaryUrl = process.env.CLOUDINARY_URL;
if (cloudinaryUrl) {
  const parts = cloudinaryUrl.replace('cloudinary://', '').split('@');
  const credentials = parts[0].split(':');
  cloudinary.config({
    cloud_name: parts[1],
    api_key: credentials[0],
    api_secret: credentials[1],
    secure: true,
  });
}

const UPLOADS_DIR = resolve(process.cwd(), 'public', 'uploads');
const CLOUDINARY_FOLDER = 'RentACarData';

async function uploadFile(fileName: string): Promise<string> {
  const filePath = resolve(UPLOADS_DIR, fileName);
  const data = readFileSync(filePath);

  const publicId = fileName.replace(/\.[^/.]+$/, '');

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        folder: CLOUDINARY_FOLDER,
        public_id: publicId,
        overwrite: false,
      },
      (error: any, result: any) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      },
    );
    uploadStream.end(data);
  });
}

async function migrate() {
  if (!existsSync(UPLOADS_DIR)) {
    console.log('No uploads directory found. Nothing to migrate.');
    return;
  }

  const files = readdirSync(UPLOADS_DIR).filter(
    (f) => f !== '.' && f !== '..',
  );

  if (files.length === 0) {
    console.log('No files to migrate.');
    return;
  }

  console.log(`Found ${files.length} files to migrate...`);

  const urlMap: Record<string, string> = {};

  for (const file of files) {
    const oldPath = `/uploads/${file}`;
    if (urlMap[oldPath]) continue;

    try {
      console.log(`Uploading ${file}...`);
      const url = await uploadFile(file);
      urlMap[oldPath] = url;
      console.log(`  -> ${url}`);
    } catch (err: any) {
      console.error(`Failed to upload ${file}:`, err.message);
    }
  }

  console.log(`\nUploaded ${Object.keys(urlMap).length} files to Cloudinary.\n`);

  // Update MongoDB references
  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/rentacar';

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('Failed to connect to MongoDB');
    await mongoose.disconnect();
    return;
  }

  const imageFields = [
    'cinFront',
    'cinBack',
    'licenseFront',
    'licenseBack',
    'photos',
  ];

  for (const collectionName of ['clients', 'users']) {
    const collection = db.collection(collectionName);
    const allDocs = await collection.find({}).toArray();

    for (const doc of allDocs) {
      const updateData: Record<string, any> = {};

      for (const field of imageFields) {
        const value = doc[field];
        if (!value) continue;

        if (Array.isArray(value)) {
          const updated = value.map((v: string) => urlMap[v] || v);
          if (updated.some((v: string, i: number) => v !== value[i])) {
            updateData[field] = updated;
          }
        } else if (typeof value === 'string' && urlMap[value]) {
          updateData[field] = urlMap[value];
        }
      }

      if (Object.keys(updateData).length > 0) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: updateData },
        );
        console.log(
          `Updated ${collectionName}.${doc._id}:`,
          JSON.stringify(updateData),
        );
      }
    }
  }

  console.log('\nMigration complete!');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
