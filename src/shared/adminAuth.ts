export type AdminRole = "project_admin" | "wavemaker_admin";

export interface AdminPublicAccount {
  id: string;
  email: string;
  role: AdminRole;
  mustChangePassword: boolean;
}

export interface AdminSessionUser {
  email: string;
  role: AdminRole;
  mustChangePassword: boolean;
}

export interface AdminLoginSuccess {
  token: string;
  email: string;
  role: AdminRole;
  mustChangePassword: boolean;
}
