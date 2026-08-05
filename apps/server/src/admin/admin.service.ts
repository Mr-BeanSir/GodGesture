import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminUserListResponse,
  UserRole,
} from '@godgesture/shared';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const bootstrap = this.config.get('ADMIN_BOOTSTRAP_EMAIL', { infer: true });
    if (!bootstrap) return;
    await this.prisma.user.updateMany({
      where: { email: bootstrap.toLowerCase(), emailVerifiedAt: { not: null } },
      data: { role: 'admin' },
    });
  }

  async listUsers(): Promise<AdminUserListResponse> {
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { _count: { select: { devices: true } } },
      }),
    ]);
    return {
      total,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
        disabled: Boolean(user.disabledAt),
        createdAt: user.createdAt.toISOString(),
        deviceCount: user._count.devices,
      })),
    };
  }

  async setDisabled(
    actorId: string,
    targetId: string,
    disabled: boolean,
  ): Promise<void> {
    if (actorId === targetId) {
      throw new ConflictException({ error: 'cannot_modify_self' });
    }
    const result = await this.prisma.user.updateMany({
      where: { id: targetId },
      data: { disabledAt: disabled ? new Date() : null },
    });
    if (!result.count) throw new NotFoundException({ error: 'user_not_found' });
    if (disabled) await this.tokens.revokeUserTokens(targetId);
    await this.audit(actorId, targetId, disabled ? 'disable_user' : 'enable_user', {
      disabled,
    });
  }

  async setRole(actorId: string, targetId: string, role: UserRole): Promise<void> {
    if (actorId === targetId) {
      throw new ConflictException({ error: 'cannot_modify_self' });
    }
    const result = await this.prisma.user.updateMany({
      where: { id: targetId },
      data: { role },
    });
    if (!result.count) throw new NotFoundException({ error: 'user_not_found' });
    await this.audit(actorId, targetId, 'set_role', { role });
  }

  async revokeSessions(actorId: string, targetId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException({ error: 'user_not_found' });
    await this.tokens.revokeUserTokens(targetId);
    await this.audit(actorId, targetId, 'revoke_sessions', {});
  }

  private audit(
    actorId: string,
    targetUserId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    return this.prisma.adminAuditLog.create({
      data: {
        actorId,
        targetUserId,
        action,
        metadata: metadata as Record<string, string | number | boolean | null>,
      },
    });
  }
}
