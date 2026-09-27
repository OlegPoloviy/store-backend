import { ConfigService } from '@nestjs/config';
import { CartSessionService } from './cart-session.service';

describe('CartSessionService', () => {
  const service = new CartSessionService({ get: () => 'a'.repeat(64) } as unknown as ConfigService);

  it('accepts only a signed random cart token', () => {
    const token = service.create();
    expect(service.parse(token)).toHaveLength(43);
    expect(() => service.parse(`${token.slice(0, -1)}x`)).toThrow();
    expect(service.parse(undefined)).toBeNull();
  });
});
