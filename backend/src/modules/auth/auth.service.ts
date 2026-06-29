import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import type { LoginInput, RefreshTokenInput } from "./auth.schemas";
import { authRepository } from "./auth.repository";

function signAccessToken(payload: { sub: string; email: string; role: string }) {
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

function signRefreshToken(payload: { sub: string; email: string; role: string; tokenUse: "refresh" }) {
  const options: SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

function issueTokens(user: { id: string; email: string; role: string }) {
  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email, role: user.role }),
    refreshToken: signRefreshToken({ sub: user.id, email: user.email, role: user.role, tokenUse: "refresh" }),
  };
}

export const authService = {
  async login(input: LoginInput) {
    const user = await authRepository.findByEmailWithPassword(input.email.toLowerCase().trim());

    if (!user || user.status !== "ACTIVO") {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    const validPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!validPassword) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    const tokens = issueTokens(user);
    const { passwordHash: _passwordHash, ...safeUser } = user;

    return { user: safeUser, ...tokens };
  },

  async refresh(input: RefreshTokenInput) {
    try {
      const payload = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET) as {
        sub?: string;
        email?: string;
        role?: string;
        tokenUse?: string;
      };

      if (!payload.sub || payload.tokenUse !== "refresh") {
        throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
      }

      const user = await authRepository.findActivePublicById(payload.sub);
      if (!user || user.status !== "ACTIVO") {
        throw new AppError("Authenticated user is no longer active", 401, "USER_INACTIVE");
      }

      return { user, ...issueTokens(user) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
    }
  },

  async getCurrentUser(id: string) {
    const user = await authRepository.findActivePublicById(id);

    if (!user || user.status !== "ACTIVO") {
      throw new AppError("Authenticated user is no longer active", 401, "USER_INACTIVE");
    }

    return user;
  },
};
