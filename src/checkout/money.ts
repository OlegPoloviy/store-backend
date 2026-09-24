import { BadRequestException } from '@nestjs/common';
import { Prisma } from 'generated/prisma';

export function toMinor(value: Prisma.Decimal | string | number): number {
  const minor = new Prisma.Decimal(value).mul(100);
  if (!minor.isInteger() || !minor.isPositive() || !minor.lessThanOrEqualTo(2147483647)) {
    throw new BadRequestException('Invalid payment amount');
  }
  return minor.toNumber();
}

export function fromMinor(value: number): string {
  return new Prisma.Decimal(value).div(100).toFixed(2);
}
