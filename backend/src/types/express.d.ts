import type { RoleName } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      email: string;
      name: string;
      role: RoleName;
      companyId?: string | null;
      sectorId?: string | null;
    }

    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
