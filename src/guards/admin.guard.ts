import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    const role = user?.app_metadata?.role || user?.user_role || user?.role;

    if (!role) {
      throw new ForbiddenException('No role provided');
    }

    if (role !== 'ADMIN') {
      throw new ForbiddenException(`Admin only. Your role: ${role}`);
    }

    return true;
  }
}
