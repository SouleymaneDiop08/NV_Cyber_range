import { SetMetadata } from '@nestjs/common';

export const SAME_SECTOR_PARAM_KEY = 'sameSectorParam';

/**
 * Exige que le secteur ciblé par la route (paramètre de route, `sectorId` par défaut)
 * corresponde au secteur de l'utilisateur connecté. Le SUPERADMIN passe toujours.
 */
export const SameSector = (paramName = 'sectorId') =>
  SetMetadata(SAME_SECTOR_PARAM_KEY, paramName);
