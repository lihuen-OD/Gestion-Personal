import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import type { ListClockDevicesQuery } from "./clockDevices.schemas";
import { authenticatedClockDevice, clockDeviceRequestMetadata as metadata } from "./clockDeviceAuthentication";
import { clockDevicesService } from "./clockDevices.service";

export const clockDevicesController = {
  register: (async (req, res) => res.status(201).json({ data: await clockDevicesService.register(req.body, { ...metadata(req), appVersion: req.body.appVersion }) })) satisfies RequestHandler,
  status: (async (req, res) => res.json({ data: await clockDevicesService.status(req.clockDevice!.id, metadata(req)) })) satisfies RequestHandler,
  refreshPairing: (async (req, res) => res.json({ data: await clockDevicesService.refreshPairing(req.clockDevice!.id, metadata(req)) })) satisfies RequestHandler,
  // F9: la identidad sale de requireClockDevice y la metadata de la request;
  // el body no se lee (cualquier ip/userAgent/deviceId/appVersion ahí se ignora).
  heartbeat: (async (req, res) => res.json({ data: await clockDevicesService.heartbeat(authenticatedClockDevice(req).id, metadata(req)) })) satisfies RequestHandler,
  list: (async (req, res) => {
    const result = await clockDevicesService.list(req.query as unknown as ListClockDevicesQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,
  getById: (async (req, res) => res.json({ data: await clockDevicesService.getById(requireParam(req, "id")) })) satisfies RequestHandler,
  resolvePairing: (async (req, res) => res.json({ data: await clockDevicesService.resolvePairing(req.body) })) satisfies RequestHandler,
  activate: (async (req, res) => res.json({ data: await clockDevicesService.activate(requireParam(req, "id"), req.body, req.user!.id, requestAuditContext(req)) })) satisfies RequestHandler,
  // F9: Asistencia muestra el nombre ACTUAL del dispositivo ("Kiosco · <nombre>"),
  // así que renombrar invalida sus cachés de lectura, como cualquier escritura
  // que cambia lo que Asistencia muestra.
  update: (async (req, res) => {
    const device = await clockDevicesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: device });
  }) satisfies RequestHandler,
  revoke: (async (req, res) => res.json({ data: await clockDevicesService.revoke(requireParam(req, "id"), req.user!.id, requestAuditContext(req)) })) satisfies RequestHandler,
  deletePending: (async (req, res) => { await clockDevicesService.deletePending(requireParam(req, "id"), requestAuditContext(req)); res.status(204).send(); }) satisfies RequestHandler,
};
