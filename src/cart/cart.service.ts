import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AddToCartDto } from 'src/DTO/add-to-cart.dto';
import { Prisma } from 'generated/prisma';

@Injectable()
export class CartService {
  constructor(private prismaService: PrismaService) {}

  async addToCart(
    userId: string | null,
    anonymousId: string | null,
    dto: AddToCartDto,
  ) {
    const { productId, quantity } = dto;

    const product = await this.prismaService.product.findUnique({
      where: {
        id: productId,
      },
      select: { id: true, price: true, images: true },
    });

    if (!product) {
      throw new NotFoundException('Requested product not found!');
    }

    if (!userId && !anonymousId) {
      throw new NotFoundException('The user can`t be identified');
    }

    const whereInput = userId
      ? { userId, status: 'ACTIVE' as const }
      : { anonymousId, status: 'ACTIVE' as const };

    let cart = await this.prismaService.cart.findFirst({
      where: whereInput,
    });

    if (!cart) {
      cart = await this.prismaService.cart.create({
        data: {
          userId,
          anonymousId,
          status: 'ACTIVE',
        },
      });
    }

    return this.prismaService.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: productId,
        },
      },
      update: {
        quantity: { increment: quantity },
      },
      create: {
        cartId: cart.id,
        productId: productId,
        quantity: quantity,
        priceSnapshot: product.price, // Фіксуємо ціну на момент додавання
      },
      include: {
        cart: {
          include: { items: true },
        },
      },
    });
  }

  async getCart(userId: string | null, anonymousId: string | null) {
    if (!userId && !anonymousId) {
      throw new BadRequestException('No user id!');
    }

    const whereInput: Prisma.CartWhereInput = userId
      ? { userId, status: 'ACTIVE' }
      : { anonymousId: anonymousId!, status: 'ACTIVE' };

    const cartQuery = {
      where: whereInput,
      include: {
        items: {
          include: {
            product: {
              include: {
                images: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    } satisfies Prisma.CartFindFirstArgs;

    const cart = await this.prismaService.cart.findFirst(cartQuery);

    if (!cart) {
      return { items: [], total: 0 };
    }

    const total = cart.items.reduce((acc, item) => {
      return acc + Number(item.priceSnapshot) * item.quantity;
    }, 0);

    const shippingPrice = 120;

    const generalPrice = Number(total + shippingPrice);

    return { ...cart, total, shippingPrice, generalPrice };
  }

  async removeItem(
    userId: string | null,
    anonymousId: string | null,
    productId: string,
  ) {
    if (!productId) {
      throw new BadRequestException('No product id!');
    }

    if (!userId && !anonymousId) {
      throw new BadRequestException('No user id!');
    }

    const whereInput: Prisma.CartWhereInput = userId
      ? { userId, status: 'ACTIVE' }
      : { anonymousId: anonymousId!, status: 'ACTIVE' };

    const cart = await this.prismaService.cart.findFirst({
      where: whereInput,
      select: { id: true },
    });

    if (!cart) {
      return { items: [], total: 0 };
    }

    await this.prismaService.cartItem.deleteMany({
      where: {
        cartId: cart.id,
        productId,
      },
    });

    return this.getCart(userId, anonymousId);
  }
}
