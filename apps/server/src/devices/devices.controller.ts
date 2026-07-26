import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListDevicesResponse, RenameDeviceRequest } from '@godgesture/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentDevice, CurrentUser } from '../auth/auth.decorators';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @ApiOperation({ summary: '设备列表(current 标记当前请求设备)' })
  list(
    @CurrentUser() userId: string,
    @CurrentDevice() deviceId: string,
  ): Promise<ListDevicesResponse> {
    return this.devices.list(userId, deviceId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '设备改名(仅限本人设备)' })
  async rename(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RenameDeviceRequest)) dto: RenameDeviceRequest,
  ): Promise<void> {
    await this.devices.rename(userId, id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '删除设备 = 踢下线(撤销全部刷新令牌;删当前设备等效登出)',
  })
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.devices.remove(userId, id);
  }
}
