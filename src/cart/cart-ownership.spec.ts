import { CartService } from './cart.service';

describe('Cart ownership during removal', () => {
  it('deletes only a line item belonging to the caller cart', async () => {
    const db: any = {
      cart: { findFirst: jest.fn().mockResolvedValue({ id: 'own-cart' }) },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new CartService(db);
    jest.spyOn(service, 'getCart').mockResolvedValue({ items: [], total: 0 });
    await service.removeItem('user-1', null, 'foreign-item');
    expect(db.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { id: 'foreign-item', cartId: 'own-cart' },
    });
  });
});
