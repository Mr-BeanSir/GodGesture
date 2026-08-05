import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import type { Env } from './config/env';
import { createOpenApiDocument } from './openapi/document';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService<Env, true>);

  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.useBodyParser('json', { limit: '300kb', strict: true });
  app.useBodyParser('urlencoded', {
    limit: '16kb',
    extended: false,
  });
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Desktop and Web Console use bearer credentials, not browser cookies. Keep the
  // API reachable from custom/self-hosted console origins and avoid the invalid
  // wildcard + credentials combination rejected by browsers.
  app.enableCors({ origin: '*', credentials: false });

  // 生产环境不暴露 API 枚举面；协议仍以 shared zod Schema 为准。
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    // Both libraries emit OpenAPI 3.0, but publish separate structural types.
    const document = createOpenApiDocument() as unknown as OpenAPIObject;
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(
    config.get('PORT', { infer: true }),
    config.get('HOST', { infer: true }),
  );
}
void bootstrap();
