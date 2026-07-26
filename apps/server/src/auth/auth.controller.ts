import {
  Body,
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
  @ApiOperation({ summary: '邮箱+密码注册(argon2id)' })
  register(
    @Body(new ZodValidationPipe(RegisterRequest)) dto: RegisterRequest,
  ): Promise<MeResponse> {
    return this.auth.register(dto);
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
