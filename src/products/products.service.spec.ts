import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { DmsService } from '../dms/dms.service';

describe('ProductsService', () => {
  let service: ProductsService;
  const product = { id: 'product-id', title: 'Oak Dining Chair', images: [] };
  const prisma = {
    product: { findUnique: jest.fn(), update: jest.fn() },
  };
  const dms = { uploadSingleFile: jest.fn(), deleteFilesByUrls: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.product.findUnique.mockResolvedValue(product);
    prisma.product.update.mockResolvedValue(product);
    dms.deleteFilesByUrls.mockResolvedValue(undefined);
    service = new ProductsService(
      prisma as unknown as PrismaService,
      dms as unknown as DmsService,
    );
  });

  it('maps categoryId and material when replacing images', async () => {
    await service.updateProduct(product.id, {
      title: product.title,
      price: '185',
      currency: 'USD',
      categoryId: '46ee643e-b6d2-4148-a163-1cc8cce65a4b',
      material: 'test',
      width: '45',
      seatingCapacity: 4,
      images: [{ url: 'https://example.com/chair.jpg', alt: 'Chair' }],
    });

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: product.id },
      data: {
        title: product.title,
        price: '185',
        currency: 'USD',
        category: { connect: { id: '46ee643e-b6d2-4148-a163-1cc8cce65a4b' } },
        primaryMaterial: 'test',
        width: '45',
        seatingCapacity: 4,
        images: {
          deleteMany: {},
          create: [{ url: 'https://example.com/chair.jpg', altText: 'Chair' }],
        },
      },
      include: { category: true, images: true },
    });
  });

  it('supports categoryId together with uploaded images', async () => {
    const file = { originalname: 'chair.jpg' } as Express.Multer.File;
    dms.uploadSingleFile.mockResolvedValue({
      url: 'https://example.com/new.jpg',
    });

    await service.updateProduct(product.id, { categoryId: 'category-id' }, [
      file,
    ]);

    expect(prisma.product.update.mock.calls[0][0].data).toEqual({
      category: { connect: { id: 'category-id' } },
      images: {
        create: [
          { url: 'https://example.com/new.jpg', altText: product.title },
        ],
      },
    });
  });

  it('keeps category names supported', async () => {
    await service.updateProduct(product.id, { category: 'Chairs' });

    expect(prisma.product.update.mock.calls[0][0].data).toEqual({
      category: {
        connectOrCreate: {
          where: { name: 'Chairs' },
          create: { name: 'Chairs' },
        },
      },
    });
  });

  it('prefers categoryId and primaryMaterial when aliases are both supplied', async () => {
    await service.updateProduct(product.id, {
      categoryId: 'category-id',
      category: 'Chairs',
      primaryMaterial: 'Oak',
      material: 'Pine',
    });

    expect(prisma.product.update.mock.calls[0][0].data).toEqual({
      category: { connect: { id: 'category-id' } },
      primaryMaterial: 'Oak',
    });
  });

  it('does not change omitted relations or fields in a partial update', async () => {
    await service.updateProduct(product.id, {
      title: 'New title',
      price: undefined,
    });

    expect(prisma.product.update.mock.calls[0][0].data).toEqual({
      title: 'New title',
    });
  });

  it('preserves a missing product as a 404', async () => {
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(
      service.updateProduct('missing', { title: 'Chair' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
