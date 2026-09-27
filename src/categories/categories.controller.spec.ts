import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtStrategy } from 'src/auth/auth.strategy';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

describe('CategoriesController access', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const originalSecret = process.env.SUPABASE_JWT_SECRET;
  const createCategory = jest.fn();
  const updateCategory = jest.fn();
  const getCategories = jest.fn();

  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = 'category-access-test-secret';

    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: process.env.SUPABASE_JWT_SECRET }),
      ],
      controllers: [CategoriesController],
      providers: [
        JwtStrategy,
        {
          provide: CategoriesService,
          useValue: { createCategory, updateCategory, getCategories },
        },
      ],
    }).compile();

    jwt = module.get(JwtService);
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    createCategory.mockReset();
    updateCategory.mockReset();
    getCategories.mockReset();
  });

  afterAll(async () => {
    await app?.close();
    if (originalSecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = originalSecret;
    }
  });

  it('keeps category listing public', async () => {
    getCategories.mockResolvedValue([{ id: '1', name: 'Chairs' }]);

    await request(app.getHttpServer())
      .get('/categories')
      .expect(200)
      .expect([{ id: '1', name: 'Chairs' }]);
  });

  it('rejects category creation without a token', async () => {
    await request(app.getHttpServer())
      .post('/categories')
      .send({ name: 'Chairs' })
      .expect(401);

    expect(createCategory).not.toHaveBeenCalled();
  });

  it('rejects category creation with an invalid token', async () => {
    await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', 'Bearer invalid-token')
      .send({ name: 'Chairs' })
      .expect(401);

    expect(createCategory).not.toHaveBeenCalled();
  });

  it('rejects category creation by a non-admin', async () => {
    const token = jwt.sign({ sub: 'user-1', user_role: 'USER' });

    await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Chairs' })
      .expect(403);

    expect(createCategory).not.toHaveBeenCalled();
  });

  it('allows an admin to create a category', async () => {
    const token = jwt.sign({ sub: 'admin-1', app_metadata: { role: 'ADMIN' } });
    const category = { id: '1', name: 'Chairs', categoryImage: null };
    createCategory.mockResolvedValue(category);

    await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Chairs' })
      .expect(201)
      .expect(category);

    expect(createCategory).toHaveBeenCalledWith({ name: 'Chairs' }, undefined);
  });

  it('rejects category updates without admin access', async () => {
    await request(app.getHttpServer())
      .patch('/categories/1')
      .send({ name: 'Tables' })
      .expect(401);

    const token = jwt.sign({ sub: 'user-1', user_role: 'USER' });
    await request(app.getHttpServer())
      .patch('/categories/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Tables' })
      .expect(403);

    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('allows an admin to update the name', async () => {
    const token = jwt.sign({ sub: 'admin-1', app_metadata: { role: 'ADMIN' } });
    const category = { id: '1', name: 'Tables', categoryImage: null };
    updateCategory.mockResolvedValue(category);

    await request(app.getHttpServer())
      .patch('/categories/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Tables' })
      .expect(200)
      .expect(category);

    expect(updateCategory).toHaveBeenCalledWith(
      '1',
      { name: 'Tables' },
      undefined,
    );
  });

  it('allows an admin to replace the image', async () => {
    const token = jwt.sign({ sub: 'admin-1', app_metadata: { role: 'ADMIN' } });
    updateCategory.mockResolvedValue({
      id: '1',
      name: 'Chairs',
      categoryImage: 'https://example.com/chairs.png',
    });

    await request(app.getHttpServer())
      .patch('/categories/1')
      .set('Authorization', `Bearer ${token}`)
      .attach('categoryImage', Buffer.from('image'), 'chairs.png')
      .expect(200);

    expect(updateCategory).toHaveBeenCalledWith(
      '1',
      {},
      expect.objectContaining({ originalname: 'chairs.png' }),
    );
  });

  it('rejects an empty update', async () => {
    const token = jwt.sign({ sub: 'admin-1', app_metadata: { role: 'ADMIN' } });

    await request(app.getHttpServer())
      .patch('/categories/1')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('rejects a null category name', async () => {
    const token = jwt.sign({ sub: 'admin-1', app_metadata: { role: 'ADMIN' } });

    await request(app.getHttpServer())
      .patch('/categories/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: null })
      .expect(400);

    expect(updateCategory).not.toHaveBeenCalled();
  });
});
