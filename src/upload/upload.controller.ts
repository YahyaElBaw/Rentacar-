import { Controller, Post, Req, BadRequestException, Inject } from '@nestjs/common';
import { Request } from 'express';
import { CLOUDINARY } from '../cloudinary/cloudinary.provider';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Busboy = require('busboy');

@Controller('upload')
export class UploadController {
  constructor(@Inject(CLOUDINARY) private readonly cloudinary: any) {}

  @Post()
  async uploadFile(@Req() req: Request) {
    return new Promise<any>((resolve, reject) => {
      let fileBuffer: Buffer | null = null;
      let originalName = '';

      const busboy = Busboy({ headers: req.headers });

      busboy.on('file', (fieldname: string, file: NodeJS.ReadableStream, info: { filename: string; encoding: string; mimeType: string }) => {
        originalName = info.filename;
        const chunks: Buffer[] = [];
        file.on('data', (chunk: Buffer) => chunks.push(chunk));
        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      busboy.on('finish', async () => {
        if (!fileBuffer) {
          reject(new BadRequestException('File is required'));
          return;
        }

        try {
          const result = await new Promise<any>((resolveUpload, rejectUpload) => {
            const uploadStream = this.cloudinary.uploader.upload_stream(
              {
                resource_type: 'auto',
                folder: 'RentACarData',
                public_id: originalName.replace(/\.[^/.]+$/, '') + '-' + Date.now(),
              },
              (error: any, result: any) => {
                if (error) rejectUpload(error);
                else resolveUpload(result);
              },
            );
            uploadStream.end(fileBuffer!);
          });

          resolve({ url: result.secure_url });
        } catch (err) {
          reject(err);
        }
      });

      busboy.on('error', (err: Error) => {
        reject(new BadRequestException('Upload failed'));
      });

      req.pipe(busboy);
    });
  }
}
