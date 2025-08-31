import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DmsService {
  private client: S3Client;
  private bucketName: string;

  constructor(private readonly configService: ConfigService) {
    this.validateConfig();
    this.initializeS3Client();
  }

  private validateConfig() {
    const requiredVars = [
      'S3_REGION',
      'S3_ACCESS_KEY',
      'S3_SECRET_ACCESS_KEY',
      'S3_BUCKET_NAME',
    ];

    for (const varName of requiredVars) {
      const value = this.configService.get(varName);
      if (!value) {
        throw new Error(`${varName} not found in environment variables`);
      }
    }

    this.bucketName = this.configService.get('S3_BUCKET_NAME');
  }

  private initializeS3Client() {
    const s3_region = this.configService.get('S3_REGION');
    const accessKeyId = this.configService.get('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get('S3_SECRET_ACCESS_KEY');

    this.client = new S3Client({
      region: s3_region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async uploadSingleFile(file: Express.Multer.File) {
    try {
      const key = `${uuidv4()}-${Date.now()}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          originalName: file.originalname,
        },
      });

      const uploadResult = await this.client.send(command);
      console.log(uploadResult);
      return await this.getFileUrl(key);
    } catch (error) {
      console.error('File upload error:', error);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async getFileUrl(key: string) {
    return { url: `https://${this.bucketName}.s3.amazonaws.com/${key}` };
  }
}
