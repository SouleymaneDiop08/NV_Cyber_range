import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SessionData } from '../../auth/services/session.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionData => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: SessionData }>();
    return request.user as SessionData;
  },
);
