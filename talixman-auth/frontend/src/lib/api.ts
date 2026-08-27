import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  // Requis par le CsrfGuard backend (défense en profondeur en plus du cookie SameSite=Strict) :
  // un formulaire HTML cross-site ne peut pas fixer ce header sur une requête.
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

export type Role = 'SUPERADMIN' | 'ADMIN' | 'GUEST';
export type AccessLevel = 'FULL' | 'VIEW_ONLY';
export type ServiceCategory = 'WORKSTATION' | 'ATTACKER' | 'SUPERVISION' | 'AUTOMATE' | 'TERRAIN';
export type SectorName = 'dispatching_electrique' | 'raffinerie' | 'systeme_ferroviaire';

export interface SessionUser {
  userId: string;
  role: Role;
  sectorId: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface Sector {
  id: string;
  name: SectorName;
  label: string;
}

export interface Service {
  id: string;
  sectorId: string;
  name: string;
  description: string | null;
  labComponent: string;
  enabled: boolean;
  accessLevel: AccessLevel;
  category: ServiceCategory | null;
  ssoTarget: string | null;
}

export interface LabComponent {
  key: string;
  label: string;
}

export interface ApiErrorBody {
  message: string | string[];
  error?: string;
  statusCode: number;
}

// --- auth ---

export async function login(email: string, password: string): Promise<{ pendingToken: string }> {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function verifyOtp(
  pendingToken: string,
  totpCode: string,
): Promise<{
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: Role;
    sectorId: string | null;
  };
}> {
  const { data } = await api.post('/auth/login/verify-otp', { pendingToken, totpCode });
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function me(): Promise<SessionUser> {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function getActivationContext(
  token: string,
): Promise<{ email: string; otpauthUrl: string; qrCodeDataUrl: string }> {
  const { data } = await api.get(`/auth/activation/${encodeURIComponent(token)}`);
  return data;
}

export async function activate(
  activationToken: string,
  password: string,
  totpCode: string,
): Promise<{ recoveryCodes: string[] }> {
  const { data } = await api.post('/auth/activate', { activationToken, password, totpCode });
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.patch('/auth/password', { currentPassword, newPassword });
}

// --- me ---

export async function listMyServices(): Promise<Service[]> {
  const { data } = await api.get('/me/services');
  return data;
}

// --- labs (Cyber Range) ---

export type LabStatus =
  | 'ABSENT'
  | 'CREATING'
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'PAUSED'
  | 'ERROR';

export interface LabServiceStatus {
  name: string;
  state: string;
  running: boolean;
}

export interface LabStatusResponse {
  labId: string | null;
  exists: boolean;
  status: LabStatus;
  services: LabServiceStatus[];
}

export async function getMyLab(): Promise<LabStatusResponse> {
  const { data } = await api.get('/labs/me');
  return data;
}

export async function startMyLab(): Promise<LabStatusResponse> {
  const { data } = await api.post('/labs/me/start');
  return data;
}

export async function stopMyLab(): Promise<LabStatusResponse> {
  const { data } = await api.post('/labs/me/stop');
  return data;
}

export async function pauseMyLab(): Promise<LabStatusResponse> {
  const { data } = await api.post('/labs/me/pause');
  return data;
}

export async function resumeMyLab(): Promise<LabStatusResponse> {
  const { data } = await api.post('/labs/me/resume');
  return data;
}

export async function deleteMyLab(): Promise<void> {
  await api.delete('/labs/me');
}

// --- sectors ---

export async function listSectors(): Promise<Sector[]> {
  const { data } = await api.get('/sectors');
  return data;
}

// --- services (SUPERADMIN only) ---

export interface CreateServiceInput {
  name: string;
  description?: string;
  labComponent: string;
  enabled?: boolean;
  accessLevel: AccessLevel;
  category?: ServiceCategory;
  ssoTarget?: string | null;
}

export type UpdateServiceInput = Partial<CreateServiceInput>;

export async function listServices(sectorId: string): Promise<Service[]> {
  const { data } = await api.get(`/sectors/${sectorId}/services`);
  return data;
}

export async function listLabComponents(sectorId: string): Promise<LabComponent[]> {
  const { data } = await api.get(`/sectors/${sectorId}/lab-components`);
  return data;
}

export async function createService(sectorId: string, dto: CreateServiceInput): Promise<Service> {
  const { data } = await api.post(`/sectors/${sectorId}/services`, dto);
  return data;
}

export async function updateService(
  sectorId: string,
  id: string,
  dto: UpdateServiceInput,
): Promise<Service> {
  const { data } = await api.patch(`/sectors/${sectorId}/services/${id}`, dto);
  return data;
}

export async function deleteService(sectorId: string, id: string): Promise<void> {
  await api.delete(`/sectors/${sectorId}/services/${id}`);
}

// --- users (SUPERADMIN creates ADMIN/SUPERADMIN, ADMIN creates GUEST) ---

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  sectorId?: string;
}

/**
 * Réponse volontairement identique que l'email existe ou non — le backend ne
 * dit jamais si un compte correspond, pour ne pas devenir un moyen d'énumérer
 * les utilisateurs.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await api.post('/auth/password/forgot', { email });
}

export async function getPasswordResetContext(token: string): Promise<{ email: string }> {
  const { data } = await api.get(`/auth/password/reset/${token}`);
  return data;
}

export async function resetPassword(
  resetToken: string,
  password: string,
  totpCode: string,
): Promise<void> {
  await api.post('/auth/password/reset', { resetToken, password, totpCode });
}

export interface CreatedUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  sectorId: string | null;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  emailSent: boolean;
}

export async function createUser(dto: CreateUserInput): Promise<CreatedUser> {
  const { data } = await api.post('/users', dto);
  return data;
}

export interface ListedUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  sectorId: string | null;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  createdById: string | null;
  createdBy: { id: string; email: string } | null;
}

export async function listUsers(role?: Role): Promise<ListedUser[]> {
  const { data } = await api.get('/users', { params: role ? { role } : undefined });
  return data;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`);
}

// Le créateur est forcément le compte connecté : le backend ne le renvoie pas.
export type MyGuest = Omit<ListedUser, 'createdBy'>;

/**
 * Invités créés par le compte connecté. Contrairement à `listUsers`, aucune
 * portée n'est passée en paramètre : le backend la dérive de la session.
 */
export async function listMyGuests(): Promise<MyGuest[]> {
  const { data } = await api.get('/users/me/guests');
  return data;
}

export async function deleteMyGuest(id: string): Promise<void> {
  await api.delete(`/users/me/guests/${id}`);
}

export function extractApiErrorMessage(err: unknown, fallback = 'Une erreur est survenue.'): string {
  if (axios.isAxiosError<ApiErrorBody>(err) && err.response?.data?.message) {
    const m = err.response.data.message;
    return Array.isArray(m) ? m.join(' ') : m;
  }
  return fallback;
}
