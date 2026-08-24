import { roles } from "./roles";

const restrictedPiiFields = new Set([
  "dni",
  "cuil",
  "birthDate",
  "gender",
  "civilStatus",
  "nationality",
  "address",
  "phone",
  "mobile",
  "email",
  "emergencyContact",
  "emergencyRelation",
  "emergencyPhone",
  "documents",
]);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !restrictedPiiFields.has(key))
      .map(([key, nested]) => [key, redactValue(nested)]),
  );
}

export function redactPiiForRole<T>(value: T, user: Express.AuthUser): T {
  return user.role === roles.cargaHoraria ? redactValue(value) as T : value;
}
