import type { RequestHandler } from "express";
import { requireParam } from "../../shared/http/params";
import { workforceService } from "./workforce.service";

export const workforceController = {
  closures: (async (req,res)=>res.json({data:await workforceService.closures(String(req.query.period),req.user!)})) satisfies RequestHandler,
  submit: (async (req,res)=>res.status(201).json({data:await workforceService.submitClosures(req.body.period,req.body.employeeIds,req.user!)})) satisfies RequestHandler,
  approve: (async (req,res)=>res.json({data:await workforceService.approveClosures(req.body.ids,req.body.note,req.user!)})) satisfies RequestHandler,
  returnClosure: (async (req,res)=>res.json({data:await workforceService.returnClosure(requireParam(req,"id"),req.body.reason,req.user!)})) satisfies RequestHandler,
  corrections: (async (req,res)=>res.json({data:await workforceService.corrections(req.user!)})) satisfies RequestHandler,
  createCorrection: (async (req,res)=>res.status(201).json({data:await workforceService.createCorrection(req.body,req.user!)})) satisfies RequestHandler,
  approveCorrection: (async (req,res)=>res.json({data:await workforceService.approveCorrection(requireParam(req,"id"),req.user!)})) satisfies RequestHandler,
  rejectCorrection: (async (req,res)=>res.json({data:await workforceService.rejectCorrection(requireParam(req,"id"),req.body.note,req.user!)})) satisfies RequestHandler,
  notifications: (async (req,res)=>res.json({data:await workforceService.notifications(req.user!)})) satisfies RequestHandler,
  unreadNotificationCount: (async (req,res)=>res.json({data:{count:await workforceService.unreadNotificationCount(req.user!)}})) satisfies RequestHandler,
  readNotification: (async (req,res)=>res.json({data:await workforceService.markNotificationRead(requireParam(req,"id"),req.user!)})) satisfies RequestHandler,
  shiftTemplates: (async (_req,res)=>res.json({data:await workforceService.shiftTemplates()})) satisfies RequestHandler,
  createShiftTemplate: (async (req,res)=>res.status(201).json({data:await workforceService.createShiftTemplate(req.body)})) satisfies RequestHandler,
  doubleRules: (async (_req,res)=>res.json({data:await workforceService.doubleRules()})) satisfies RequestHandler,
  createDoubleRule: (async (req,res)=>res.status(201).json({data:await workforceService.createDoubleRule(req.body,req.user!)})) satisfies RequestHandler,
};
