import { DynamicModule, Module } from '@nestjs/common';
import { WorkspaceRuntime } from './http/workspace-runtime';
import { WorkspaceController } from './http/workspace.controller';
import type { ServerConfig } from './http/server-policy';

@Module({})
export class AppModule {
  static configure(config: ServerConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [WorkspaceController],
      providers: [
        {
          provide: WorkspaceRuntime,
          useFactory: () => WorkspaceRuntime.open(config),
        },
      ],
    };
  }
}
