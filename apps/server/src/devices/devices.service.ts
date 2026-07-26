import { Injectable, NotFoundException } from '@nestjs/common';
import type { ListDevicesResponse } from '@godgesture/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/token.service';

/**
 * 设备管理(Web 控制台):列表 / 改名 / 踢下线。
 * 归属校验:一切操作都以 userId 为查询条件,查不到即 404,不泄露他人设备存在性。
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async list(
    userId: string,
    currentDeviceId: string,
  ): Promise<ListDevicesResponse> {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        current: d.id === currentDeviceId,
      })),
    };
  }

  async rename(userId: string, deviceId: string, name: string): Promise<void> {
    // updateMany 带 userId 条件 = 归属校验 + 更新一步完成
    const updated = await this.prisma.device.updateMany({
      where: { id: deviceId, userId },
      data: { name },
    });
    if (updated.count === 0) {
      throw new NotFoundException({ error: 'device_not_found' });
    }
  }

  /**
   * 删除设备 = 踢下线:先撤销其全部刷新令牌,再删除设备记录
   * (RefreshToken 级联删除;ConfigSnapshot.deviceId 外键 SetNull,历史保留)。
   * 允许删除当前设备,等效登出。
   */
  async remove(userId: string, deviceId: string): Promise<void> {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
      select: { id: true },
    });
    if (!device) {
      throw new NotFoundException({ error: 'device_not_found' });
    }
    await this.tokens.revokeDeviceTokens(deviceId);
    await this.prisma.device.delete({ where: { id: deviceId } });
  }
}
