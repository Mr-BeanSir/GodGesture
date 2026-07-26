import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useGlobalFilters(new PrismaExceptionFilter());

  // CORS:Web 控制台源 + 额外配置源;Tauri 桌面端 WebView 源默认放行
  const origins = new Set<string>([
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
  ]);
  const webConsole = config.get('WEB_CONSOLE_ORIGIN', { infer: true });
  if (webConsole) origins.add(webConsole);
  const extra = config.get('CORS_ORIGINS', { infer: true });
  if (extra) {
    for (const origin of extra.split(',')) {
      const trimmed = origin.trim();
      if (trimmed) origins.add(trimmed);
    }
  }
  app.enableCors({ origin: [...origins], credentials: true });

  // Swagger(/docs):仅粗粒度文档,协议以 @godgesture/shared 的 zod Schema 为准
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('GodGesture API')
      .setDescription(
        'GodGesture 同步后端。请求/响应契约的唯一事实来源是 @godgesture/shared 中的 zod Schema。',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, doc);

  await app.listen(config.get('PORT', { infer: true }));
}
void bootstrap();
