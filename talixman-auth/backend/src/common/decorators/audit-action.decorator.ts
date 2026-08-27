import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'auditAction';

/** Marque une route comme action sensible à consigner dans AuditLog en cas de succès. */
export const AuditAction = (action: string) =>
  SetMetadata(AUDIT_ACTION_KEY, action);
