import { createApplication } from './http/create-application';
import { serverConfig } from './http/server-policy';
import { publicError } from './http/api-error';

async function bootstrap(): Promise<void> {
  const config = serverConfig(process.env);
  const app = await createApplication(config);
  app.enableShutdownHooks();
  try {
    await app.listen(config.port, '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
  process.stdout.write(`RadishInk API listening on 127.0.0.1:${config.port}\n`);
}
void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `RadishInk startup failed: ${publicError(error).code}\n`,
  );
  process.exitCode = 1;
});
