import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { HTTP_POLICY, ServerConfig } from './server-policy';

export async function createApplication(
  config: ServerConfig,
): Promise<NestExpressApplication> {
  // 请求体由有界解析器处理；不挂载旧上传、静态 uploads、CORS 或默认 JSON parser。
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.configure(config),
    { bodyParser: false, logger: false, abortOnError: false },
  );
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  await app.init();
  const server = app.getHttpServer();
  server.requestTimeout = HTTP_POLICY.requestMs;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = HTTP_POLICY.connections;
  server.maxRequestsPerSocket = 100;
  return app;
}
