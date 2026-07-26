import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipRateLimit } from './common/rate-limit.decorator';

@ApiTags('meta')
@Controller()
export class AppController {
  @Get('health')
  @SkipRateLimit()
  @ApiOperation({ summary: '健康检查(容器/反代探活用)' })
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
