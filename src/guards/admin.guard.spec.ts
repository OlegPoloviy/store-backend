import { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const guard = new AdminGuard();
  const context = (user: any) => ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext);

  it('does not trust user-editable metadata for admin privileges', () => {
    expect(() => guard.canActivate(context({ user_metadata: { role: 'ADMIN' }, role: 'authenticated' }))).toThrow();
    expect(guard.canActivate(context({ app_metadata: { role: 'ADMIN' }, role: 'authenticated' }))).toBe(true);
  });
});
