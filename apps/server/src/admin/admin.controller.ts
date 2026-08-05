import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminAccountStateRequest,
  AdminRoleRequest,
  AdminUserListResponse,
} from '@godgesture/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/auth.decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: '管理员查看账户元数据' })
  users(): Promise<AdminUserListResponse> {
    return this.admin.listUsers();
  }

  @Post('users/:id/state')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '管理员启用或禁用账户' })
  async state(
    @CurrentUser() actorId: string,
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body(new ZodValidationPipe(AdminAccountStateRequest))
    dto: AdminAccountStateRequest,
  ): Promise<void> {
    await this.admin.setDisabled(actorId, targetId, dto.disabled);
  }

  @Post('users/:id/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '管理员调整账户角色' })
  async role(
    @CurrentUser() actorId: string,
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body(new ZodValidationPipe(AdminRoleRequest)) dto: AdminRoleRequest,
  ): Promise<void> {
    await this.admin.setRole(actorId, targetId, dto.role);
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '管理员撤销账户全部设备会话' })
  async revokeSessions(
    @CurrentUser() actorId: string,
    @Param('id', ParseUUIDPipe) targetId: string,
  ): Promise<void> {
    await this.admin.revokeSessions(actorId, targetId);
  }
}
