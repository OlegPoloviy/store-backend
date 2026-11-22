import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureBodyParsers } from './http-body-parsers';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureBodyParsers(app);

  if (
    process.env.PAYMENT_MODE === 'mock' &&
    process.env.NODE_ENV !== 'development'
  ) {
    throw new Error('Mock payments require NODE_ENV=development');
  }

  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS is required in production');
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3001);

  await app.listen(port, '0.0.0.0');
}

bootstrap();
