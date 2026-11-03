import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { roles } from "../../shared/security/roles";
import { validateQuery } from "../../shared/validation/validateQuery";
import { validateBody } from "../../shared/validation/validateRequest";
import { employeeDayOffController as c } from "./employeeDayOff.controller";
import { employeeDayOffsByDateQuerySchema, listEmployeeDayOffsQuerySchema, saveEmployeeDayOffsSchema } from "./employeeDayOff.schemas";

// docs/decisions/EMPLOYEE_DAY_OFF.md §10-§11: los tres niveles operativos leen
// y guardan francos, siempre dentro de employeeAccessWhere (el servicio
// verifica el alcance de cada persona del lote).
export const employeeDayOffsRouter = Router();
employeeDayOffsRouter.use(requireAuth);

const operational = [roles.rrhh, roles.supervision, roles.cargaHoraria];

employeeDayOffsRouter.get("/", requireAnyRole(operational), validateQuery(listEmployeeDayOffsQuerySchema), asyncHandler(c.list));
employeeDayOffsRouter.get("/by-date", requireAnyRole(operational), validateQuery(employeeDayOffsByDateQuerySchema), asyncHandler(c.byDate));
employeeDayOffsRouter.put("/", requireAnyRole(operational), validateBody(saveEmployeeDayOffsSchema), asyncHandler(c.save));
