import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { OAuthProviderRegistry } from './oauth/provider.registry';
import { GithubOAuthProvider } from './oauth/github.provider';
import { GoogleOAuthProvider } from './oauth/google.provider';
import { WechatOAuthProvider } from './oauth/wechat.provider';
import { QqOAuthProvider } from './oauth/qq.provider';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController, OAuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    OAuthService,
    OAuthProviderRegistry,
    GithubOAuthProvider,
    GoogleOAuthProvider,
    WechatOAuthProvider,
    QqOAuthProvider,
  ],
  exports: [TokenService, JwtAuthGuard],
})
export class AuthModule {}
