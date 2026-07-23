import { v2 as cloudinary } from 'cloudinary';

export const CLOUDINARY = 'CLOUDINARY';

export const CloudinaryProvider = {
  provide: CLOUDINARY,
  useFactory: () => {
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
    return cloudinary;
  },
};
