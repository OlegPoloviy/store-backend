import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { Express } from 'express';

@Injectable()
export class DmsService {
  private readonly bucketName = 'product-images';
  private supabaseUrl: string;
  private supabaseKey: string;
  private storageUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.validateConfig();
  }

  private validateConfig() {
    const supabaseUrl = this.getConfigValue('SUPABASE_URL');
    const supabaseKey = this.getSupabaseStorageKey();

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL not found in environment variables');
    }
    if (!supabaseKey) {
      throw new Error(
        'Valid SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY not found in environment variables',
      );
    }

    this.supabaseUrl = supabaseUrl.replace(/\/$/, '');
    this.supabaseKey = supabaseKey;
    this.storageUrl = `${this.supabaseUrl}/storage/v1`;
  }

  private getConfigValue(key: string): string | undefined {
    return this.configService.get<string>(key) || process.env[key];
  }

  private getSupabaseStorageKey(): string | undefined {
    const serviceRoleKey = this.getConfigValue('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = this.getConfigValue('SUPABASE_ANON_KEY');

    if (this.isCompactJws(serviceRoleKey)) {
      return serviceRoleKey;
    }
    if (this.isCompactJws(anonKey)) {
      return anonKey;
    }

    return undefined;
  }

  private isCompactJws(value?: string): value is string {
    return Boolean(value && value.split('.').length === 3);
  }

  private encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  private getFileExtension(file: Express.Multer.File): string {
    const originalExtension = file.originalname.split('.').pop();
    if (originalExtension && originalExtension !== file.originalname) {
      return originalExtension.toLowerCase();
    }

    return file.mimetype.split('/').pop() || 'bin';
  }

  private createStoragePath(file: Express.Multer.File, folder: string): string {
    const extension = this.getFileExtension(file);
    return `${folder}/${uuidv4()}-${Date.now()}.${extension}`;
  }

  async uploadSingleFile(file: Express.Multer.File, folder = 'uploads') {
    try {
      const path = this.createStoragePath(file, folder);
      const uploadBody = new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype,
      });
      const response = await fetch(
        `${this.storageUrl}/object/${this.bucketName}/${this.encodePath(path)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
            'Content-Type': file.mimetype,
            'x-upsert': 'false',
          },
          body: uploadBody,
        },
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return this.getFileUrl(path);
    } catch (error) {
      console.error('File upload error:', error);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  getFileUrl(path: string) {
    return {
      path,
      url: `${this.storageUrl}/object/public/${this.bucketName}/${this.encodePath(path)}`,
    };
  }

  getPathFromUrl(url: string): string | null {
    const publicPrefix = `/storage/v1/object/public/${this.bucketName}/`;
    const objectPrefix = `/storage/v1/object/${this.bucketName}/`;

    try {
      const { pathname } = new URL(url);
      const prefix = pathname.includes(publicPrefix)
        ? publicPrefix
        : objectPrefix;
      const pathStart = pathname.indexOf(prefix);

      if (pathStart === -1) {
        return null;
      }

      return decodeURIComponent(pathname.slice(pathStart + prefix.length));
    } catch {
      return null;
    }
  }

  async deleteFilesByUrls(urls: string[]) {
    const paths = urls
      .map((url) => this.getPathFromUrl(url))
      .filter((path): path is string => Boolean(path));

    if (paths.length === 0) {
      return;
    }

    try {
      const response = await fetch(
        `${this.storageUrl}/object/${this.bucketName}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes: paths }),
        },
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }
    } catch (error) {
      console.error('File delete error:', error);
      throw new InternalServerErrorException('Failed to delete files');
    }
  }
}
