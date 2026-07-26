import { Injectable, NotFoundException } from '@nestjs/common';
import type { ListDevicesResponse } from '@godgesture/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 设备管理(Web 控制台):列表 / 改名 / 踢下线。
 * 归属校验:一切操作都以 userId 为查询条件,查不到即 404,不泄露他人设备存在性。
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

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
   * 删除设备 = 踢下线。允许删除当前设备,等效登出。
   *
   * deleteMany 带 userId = 归属校验 + 删除一步完成(与 rename 同款)。单条语句天然原子:
   * 并发重复删除得到 404 而非 500,也不存在"查到了但删的时候没了"的时间窗。
   * 刷新令牌由 RefreshToken.deviceId 的 onDelete: Cascade 直接删掉 —— 比标记 revokedAt
   * 更彻底,连并发轮换刚插进来的新令牌一起带走;ConfigSnapshot.deviceId 是 SetNull,
   * 同步历史保留。
   *
   * 顺序不可颠倒:`TokenService.revokeDeviceTokens` 不带 userId 约束,若把它放到归属
   * 校验之前,别人的设备 id 就能被用来撤销其令牌。带 userId 的删除必须是唯一的写语句。
   */
  async remove(userId: string, deviceId: string): Promise<void> {
    const deleted = await this.prisma.device.deleteMany({
      where: { id: deviceId, userId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({ error: 'device_not_found' });
    }
  }
}
