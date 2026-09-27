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
      select: { id: true, price: true, currency: true },
    });

    if (!product) {
      throw new NotFoundException('Requested product not found!');
    }

    if (!userId && !anonymousId) {
      throw new NotFoundException('The user can`t be identified');
    }

    return this.prismaService.$transaction(async (tx) => {
      const owner = userId ? `user:${userId}` : `guest:${anonymousId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${owner}))`;
      const whereInput = userId
        ? { userId, status: 'ACTIVE' as const }
        : { anonymousId, status: 'ACTIVE' as const };
      let cart = await tx.cart.findFirst({ where: whereInput });
      if (!cart) {
        cart = await tx.cart.create({ data: { userId, anonymousId, status: 'ACTIVE' } });
      }
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Cart" WHERE id = ${cart.id} AND status = 'ACTIVE' FOR UPDATE`;
      if (locked.length !== 1) throw new BadRequestException('Cart is already checked out');
      const active = await tx.cart.findFirst({ where: { id: cart.id, status: 'ACTIVE' } });
      if (!active) throw new BadRequestException('Cart is already checked out');
      const existingItem = await tx.cartItem.findFirst({
        where: { cartId: cart.id },
        select: { currencySnapshot: true },
      });
      if (existingItem && existingItem.currencySnapshot !== product.currency) {
        throw new BadRequestException('Cart items must use the same currency');
      }
      const current = await tx.cartItem.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId } },
        select: { quantity: true },
      });
      if (quantity > 100 || (current?.quantity || 0) + quantity > 100) {
        throw new BadRequestException('Maximum quantity is 100');
      }
      return tx.cartItem.upsert({
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
        currencySnapshot: product.currency,
      },
      include: {
        cart: {
          include: { items: true },
        },
      },
      });
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
      return { items: [], total: '0.00', currency: null };
    }

    const currency = cart.items[0]?.product.currency ?? null;
    const total = cart.items.reduce(
      (acc, item) => acc.plus(item.product.price.mul(item.quantity)),
      new Prisma.Decimal(0),
    );
    const items = cart.items.map((item) => ({
      ...item,
      currentUnitPrice: item.product.price.toFixed(2),
      priceChanged: !item.priceSnapshot.equals(item.product.price),
    }));
    return { ...cart, items, total: total.toFixed(2), currency };
  }

  async removeItem(
    userId: string | null,
    anonymousId: string | null,
    cartItemId: string,
  ) {
    if (!cartItemId) {
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
      return { items: [], total: '0.00', currency: null };
    }

    await this.prismaService.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Cart" WHERE id = ${cart.id} AND status = 'ACTIVE' FOR UPDATE`;
      if (locked.length !== 1) throw new BadRequestException('Cart is already checked out');
      await tx.cartItem.deleteMany({ where: { id: cartItemId, cartId: cart.id } });
    });

    return this.getCart(userId, anonymousId);
  }

  async updateItemQuantity(
    userId: string | null,
    anonymousId: string | null,
    itemId: string,
    action: string,
  ) {
    const whereInput: Prisma.CartWhereInput = userId
      ? { userId, status: 'ACTIVE' }
      : { anonymousId: anonymousId!, status: 'ACTIVE' };

    const cart = await this.prismaService.cart.findFirst({
      where: whereInput,
      select: { id: true },
    });

    if (!cart) {
      return { items: [], total: '0.00', currency: null };
    }

    await this.prismaService.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Cart" WHERE id = ${cart.id} AND status = 'ACTIVE' FOR UPDATE`;
      if (locked.length !== 1) throw new BadRequestException('Cart is already checked out');
      const cartItem = await tx.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
      if (!cartItem) return;
      if (action === 'increase') {
        if (cartItem.quantity >= 100) throw new BadRequestException('Maximum quantity is 100');
        await tx.cartItem.update({ where: { id: itemId }, data: { quantity: { increment: 1 } } });
      } else if (action === 'decrease') {
        if (cartItem.quantity > 1) {
          await tx.cartItem.update({ where: { id: itemId }, data: { quantity: { decrement: 1 } } });
        } else {
          await tx.cartItem.delete({ where: { id: itemId } });
        }
      }
    });

    return this.getCart(userId, anonymousId);
  }
}
