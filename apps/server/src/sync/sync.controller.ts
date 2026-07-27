import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ListSnapshotsResponse,
  PullConfigResponse,
  PushConfigRequest,
  PushConfigResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
} from '@godgesture/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentDevice, CurrentUser } from '../auth/auth.decorators';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('config')
  @ApiOperation({ summary: '拉取配置(version 0 = 账户尚无配置)' })
  pull(@CurrentUser() userId: string): Promise<PullConfigResponse> {
    return this.sync.pull(userId);
  }

  @Put('config')
  @ApiOperation({
    summary: '推送配置(乐观并发:baseVersion 不符回 409 version_conflict)',
  })
  push(
    @CurrentUser() userId: string,
    @CurrentDevice() deviceId: string,
    @Body(new ZodValidationPipe(PushConfigRequest)) dto: PushConfigRequest,
  ): Promise<PushConfigResponse> {
    return this.sync.push(userId, deviceId, dto);
  }

  @Get('snapshots')
  @ApiOperation({ summary: '快照列表(按版本降序,至多 100 条)' })
  listSnapshots(@CurrentUser() userId: string): Promise<ListSnapshotsResponse> {
    return this.sync.listSnapshots(userId);
  }

  @Post('snapshots/:version/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '回滚:按确认时 baseVersion 以快照内容推进一个新版本',
  })
  restore(
    @CurrentUser() userId: string,
    @CurrentDevice() deviceId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body(new ZodValidationPipe(RestoreSnapshotRequest))
    dto: RestoreSnapshotRequest,
  ): Promise<RestoreSnapshotResponse> {
    return this.sync.restoreSnapshot(userId, deviceId, version, dto);
  }
}
