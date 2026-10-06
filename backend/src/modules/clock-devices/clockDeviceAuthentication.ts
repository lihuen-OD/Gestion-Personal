import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/AppError";
import { hashClockDeviceSecret, verifyClockDeviceSecret } from "../../shared/security/clockDeviceCredentials";
import { clockDevicesRepository } from "./clockDevices.repository";

const DUMMY_HASH = hashClockDeviceSecret("invalid-clock-device-credential");

export const requireClockDevice: RequestHandler = async (req, _res, next) => {
  try {
    const authorization = req.get("authorization") || "";
    const match = /^ClockDevice\s+([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/i.exec(authorization);
    const id = match?.[1] || "00000000-0000-0000-0000-000000000000";
    const secret = match?.[2] || "invalid";
    const credential = await clockDevicesRepository.findCredentialById(id);
    const valid = verifyClockDeviceSecret(secret, credential?.tokenHash || DUMMY_HASH);
    if (!match || !credential || !valid) throw new AppError("Invalid device credentials", 401, "CLOCK_DEVICE_INVALID_CREDENTIAL");
    req.clockDevice = { id: credential.id, status: credential.status };
    next();
  } catch (error) {
    next(error);
  }
};
