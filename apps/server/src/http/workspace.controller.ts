import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WorkspaceRuntime } from './workspace-runtime';

@Controller()
export class WorkspaceController {
  constructor(private readonly runtime: WorkspaceRuntime) {}
  @All('{*path}')
  handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.runtime.handle(req, res);
  }
}
