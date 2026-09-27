import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from 'generated/prisma';

describe('CartService', () => {
  let service: CartService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CartService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('captures the product price and currency when adding a cart item', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'item-1' });
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          price: new Prisma.Decimal('12.50'),
          currency: 'EUR',
          images: [],
        }),
      },
      cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { upsert },
    };
    const cartService = new CartService(prisma as unknown as PrismaService);

    await cartService.addToCart('user-1', null, {
      productId: 'product-1',
      quantity: 2,
    });

    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      select: { id: true, price: true, currency: true, images: true },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          priceSnapshot: new Prisma.Decimal('12.50'),
          currencySnapshot: 'EUR',
        }),
      }),
    );
  });
});
