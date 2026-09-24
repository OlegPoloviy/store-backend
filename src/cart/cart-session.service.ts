import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

@Injectable()
export class CartSessionService {
  constructor(private readonly config: ConfigService) {}

  private secret(): string {
    const value = this.config.get<string>('CART_SESSION_SECRET');
    if (!value || value.length < 32) {
      throw new Error('CART_SESSION_SECRET must contain at least 32 characters');
    }
    return value;
  }

  create(): string {
    const id = randomBytes(32).toString('base64url');
    return `${id}.${this.sign(id)}`;
  }

  parse(token?: string): string | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[0])) {
      throw new BadRequestException('Invalid cart token');
    }
    const expected = Buffer.from(this.sign(parts[0]), 'ascii');
    const received = Buffer.from(parts[1], 'ascii');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new BadRequestException('Invalid cart token');
    }
    return parts[0];
  }

  private sign(id: string): string {
    return createHmac('sha256', this.secret()).update(id).digest('base64url');
  }
}
