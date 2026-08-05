import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthedRequest } from '../auth/jwt-auth.guard';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = request.auth?.userId;
    if (!userId) {
      throw new ForbiddenException({ error: 'admin_required' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, disabledAt: true },
    });
    if (!user || user.disabledAt || user.role !== 'admin') {
      throw new ForbiddenException({ error: 'admin_required' });
    }
    return true;
  }
}
