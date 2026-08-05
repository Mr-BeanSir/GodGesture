import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  LoginRequest,
  MeResponse,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RequestEmailCodeRequest,
  RequestEmailCodeResponse,
  RefreshRequest,
  RegisterRequest,
  TokenPairResponse,
} from '@godgesture/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentDevice, CurrentUser } from './auth.decorators';
import { RateLimit } from '../common/rate-limit.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('register')
  @RateLimit('register', 3, 60 * 60 * 1000)
  @ApiOperation({ summary: '邮箱验证码+密码注册(argon2id)' })
  register(
    @Body(new ZodValidationPipe(RegisterRequest)) dto: RegisterRequest,
  ): Promise<MeResponse> {
    return this.auth.register(dto);
  }

  @Post('email-verification/request')
  @RateLimit('email-verification', 5, 3 * 60 * 1000)
  @ApiOperation({ summary: '发送邮箱注册验证码' })
  requestRegistrationCode(
    @Body(new ZodValidationPipe(RequestEmailCodeRequest))
    dto: RequestEmailCodeRequest,
  ): Promise<RequestEmailCodeResponse> {
    if (dto.purpose !== 'register') {
      throw new BadRequestException({ error: 'invalid_email_code_purpose' });
    }
    return this.auth.requestRegistrationCode(dto.email);
  }

  @Post('password-reset/request')
  @RateLimit('password-reset-request', 5, 3 * 60 * 1000)
  @ApiOperation({ summary: '请求密码找回验证码(不泄露邮箱是否存在)' })
  requestPasswordReset(
    @Body(new ZodValidationPipe(PasswordResetRequest))
    dto: PasswordResetRequest,
  ): Promise<RequestEmailCodeResponse> {
    return this.auth.requestPasswordReset(dto);
  }

  @Post('password-reset/confirm')
  @RateLimit('password-reset-confirm', 5, 10 * 60 * 1000)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '使用邮箱验证码设置新密码并撤销既有会话' })
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(PasswordResetConfirmRequest))
    dto: PasswordResetConfirmRequest,
  ): Promise<void> {
    await this.auth.confirmPasswordReset(dto);
  }

  @Post('login')
  @RateLimit('login', 5, 60 * 1000)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录:登记设备并签发令牌对' })
  login(
    @Body(new ZodValidationPipe(LoginRequest)) dto: LoginRequest,
  ): Promise<TokenPairResponse> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @RateLimit('refresh', 20, 60 * 1000)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌轮换(旧令牌作废)' })
  refresh(
    @Body(new ZodValidationPipe(RefreshRequest)) dto: RefreshRequest,
  ): Promise<TokenPairResponse> {
    return this.tokens.rotateRefreshToken(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '登出:撤销当前设备的刷新令牌' })
  async logout(@CurrentDevice() deviceId: string): Promise<void> {
    await this.auth.logout(deviceId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前账户信息' })
  me(@CurrentUser() userId: string): Promise<MeResponse> {
    return this.auth.me(userId);
  }
}
