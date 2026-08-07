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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ListSnapshotsResponse,
  ListSnapshotsQuery,
  ConfigIndexResponse,
  ConfigScopeResponse,
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

  @Get('config/index')
  @ApiOperation({ summary: '读取配置索引(分组和应用摘要,不返回手势列表)' })
  configIndex(@CurrentUser() userId: string): Promise<ConfigIndexResponse> {
    return this.sync.configIndex(userId);
  }

  @Get('config/scope/:scope')
  @ApiOperation({ summary: '读取当前全局或应用的手势详情' })
  configScope(
    @CurrentUser() userId: string,
    @Param('scope') scope: string,
  ): Promise<ConfigScopeResponse> {
    return this.sync.configScope(userId, scope);
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
  @ApiOperation({ summary: '分页快照列表(按版本降序,单页至多 50 条)' })
  listSnapshots(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(ListSnapshotsQuery)) query: ListSnapshotsQuery,
  ): Promise<ListSnapshotsResponse> {
    return this.sync.listSnapshots(userId, query);
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
