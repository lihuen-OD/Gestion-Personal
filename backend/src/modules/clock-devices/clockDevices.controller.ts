import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListClockDevicesQuery } from "./clockDevices.schemas";
import { clockDeviceRequestMetadata as metadata } from "./clockDeviceAuthentication";
import { clockDevicesService } from "./clockDevices.service";

export const clockDevicesController = {
  register: (async (req, res) => res.status(201).json({ data: await clockDevicesService.register(req.body, { ...metadata(req), appVersion: req.body.appVersion }) })) satisfies RequestHandler,
  status: (async (req, res) => res.json({ data: await clockDevicesService.status(req.clockDevice!.id, metadata(req)) })) satisfies RequestHandler,
  refreshPairing: (async (req, res) => res.json({ data: await clockDevicesService.refreshPairing(req.clockDevice!.id, metadata(req)) })) satisfies RequestHandler,
  list: (async (req, res) => {
    const result = await clockDevicesService.list(req.query as unknown as ListClockDevicesQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,
  getById: (async (req, res) => res.json({ data: await clockDevicesService.getById(requireParam(req, "id")) })) satisfies RequestHandler,
  resolvePairing: (async (req, res) => res.json({ data: await clockDevicesService.resolvePairing(req.body) })) satisfies RequestHandler,
  activate: (async (req, res) => res.json({ data: await clockDevicesService.activate(requireParam(req, "id"), req.body, req.user!.id, requestAuditContext(req)) })) satisfies RequestHandler,
  revoke: (async (req, res) => res.json({ data: await clockDevicesService.revoke(requireParam(req, "id"), req.user!.id, requestAuditContext(req)) })) satisfies RequestHandler,
  deletePending: (async (req, res) => { await clockDevicesService.deletePending(requireParam(req, "id"), requestAuditContext(req)); res.status(204).send(); }) satisfies RequestHandler,
};
