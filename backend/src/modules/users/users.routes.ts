import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { requireAnyRole } from "../../middlewares/authorization";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { adminRoles } from "../../shared/security/roles";
import { validateBody } from "../../shared/validation/validateRequest";
import { validateQuery } from "../../shared/validation/validateQuery";
import { usersController } from "./users.controller";
import { createUserSchema, listUsersQuerySchema, resetPasswordSchema, updateUserSchema } from "./users.schemas";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireAnyRole(adminRoles));

usersRouter.get(
  "/",
  validateQuery(listUsersQuerySchema),
  asyncHandler(usersController.list),
);

usersRouter.get(
  "/:id",
  asyncHandler(usersController.getById),
);

usersRouter.post(
  "/",
  validateBody(createUserSchema),
  asyncHandler(usersController.create),
);

usersRouter.patch(
  "/:id",
  validateBody(updateUserSchema),
  asyncHandler(usersController.update),
);

usersRouter.post(
  "/:id/reset-password",
  validateBody(resetPasswordSchema),
  asyncHandler(usersController.resetPassword),
);
