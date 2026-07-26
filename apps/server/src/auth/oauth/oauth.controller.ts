import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OAuthExchangeRequest, TokenPairResponse } from '@godgesture/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { OAuthService } from './oauth.service';
import { RateLimit } from '../../common/rate-limit.decorator';

@ApiTags('auth/oauth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Get(':provider/authorize')
  @RateLimit('oauth-authorize', 10, 60 * 1000)
  @ApiOperation({
    summary: '跳转提供方授权页(redirect_uri 仅限桌面回环或 Web 控制台)',
  })
  authorize(
    @Param('provider') provider: string,
    @Query('redirect_uri') redirectUri: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): void {
    const url = this.oauth.buildAuthorizeRedirect(provider, redirectUri, state);
    res.redirect(HttpStatus.FOUND, url);
  }

  @Get(':provider/callback')
  @RateLimit('oauth-callback', 20, 60 * 1000)
  @ApiOperation({
    summary: '提供方回调:换取身份并携一次性授权码回跳客户端',
  })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.oauth.handleCallback(provider, code, state);
    res.redirect(HttpStatus.FOUND, url);
  }

  @Post('exchange')
  @RateLimit('oauth-exchange', 10, 60 * 1000)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '一次性授权码换令牌对(登记设备)' })
  exchange(
    @Body(new ZodValidationPipe(OAuthExchangeRequest))
    dto: OAuthExchangeRequest,
  ): Promise<TokenPairResponse> {
    return this.oauth.exchange(dto);
  }
}
