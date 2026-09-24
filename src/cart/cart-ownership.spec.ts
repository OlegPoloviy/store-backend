import { CartService } from './cart.service';

describe('Cart ownership during removal', () => {
  it('deletes only a line item belonging to the caller cart', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'own-cart' }]),
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const db: any = {
      cart: { findFirst: jest.fn().mockResolvedValue({ id: 'own-cart' }) },
      $transaction: (fn: (client: any) => Promise<any>) => fn(tx),
    };
    const service = new CartService(db);
    jest.spyOn(service, 'getCart').mockResolvedValue({ items: [], total: '0.00', currency: null });
    await service.removeItem('user-1', null, 'foreign-item');
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { id: 'foreign-item', cartId: 'own-cart' },
    });
  });
});
