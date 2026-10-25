import { StorageError } from '../storage/storage-contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export function publicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageError) {
    const statuses = {
      invalid: 422,
      'not-found': 404,
      conflict: 409,
      'idempotency-mismatch': 409,
      capacity: 507,
      corrupt: 503,
      locked: 503,
      'schema-incompatible': 503,
      'mode-mismatch': 503,
    };
    if (error.cause) {
      const cause = publicError(error.cause);
      if (cause.status === 507) return cause;
    }
    return new ApiError(statuses[error.code], error.code);
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT')
    return new ApiError(507, 'capacity');
  return new ApiError(503, 'unavailable');
}

export const ERROR_MESSAGES: Record<number, string> = {
  401: '登录失效或凭据错误',
  403: '来源或 CSRF 校验失败',
  404: '目标不存在或不可访问',
  409: '版本或操作冲突，请保留当前编辑',
  413: '请求或文章超出限制',
  422: '请求格式或资源无效',
  429: '请求过多，请稍后重试',
  503: '服务暂不可用，请保留当前编辑',
  507: '存储容量不足，请联系管理员',
};
