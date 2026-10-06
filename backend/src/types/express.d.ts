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
      // Lo setea sólo requireClockDevice (modules/clock-devices). Nunca
      // incluye tokenHash ni pairingCodeHash y nunca convive con req.user.
      clockDevice?: {
        id: string;
        status: "PENDING" | "ACTIVE" | "REVOKED";
        name: string | null;
        sectorId: string | null;
      };
    }
  }
}

export {};
