import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { finnegansExportRepository } from "./finnegansExport.repository";
import type { FinnegansExportQuery } from "./finnegansExport.schemas";

export type FinnegansExportRow = {
  Legajo: string;
  Novedad: string;
  "Centro de costo": string;
  "Valor 1": string;
  "Fecha Aplicación": string;
  "Fecha desde": string;
  "Fecha hasta": string;
  sourceId?: string;
  employeeId?: string;
  employeeName?: string;
  detail?: string;
};

function formatDate(value: Date | null | undefined) {
  if (!value) return "";
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const year = value.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function decimalToString(value: Prisma.Decimal | null | undefined) {
  if (!value) return "";
  return value.toString();
}

function resolveValue1(item: Awaited<ReturnType<typeof finnegansExportRepository.findExportableNovelties>>[number]) {
  return decimalToString(item.quantityHours) || decimalToString(item.quantityDays) || "1";
}

function toExportRow(item: Awaited<ReturnType<typeof finnegansExportRepository.findExportableNovelties>>[number]): FinnegansExportRow {
  const link = item.noveltyType.finnegansLinks[0];
  return {
    Legajo: item.employee.legajoFinnegans || item.employee.legajo,
    Novedad: link?.code || "",
    "Centro de costo": "",
    "Valor 1": resolveValue1(item),
    "Fecha Aplicación": formatDate(item.fromDate),
    "Fecha desde": item.noveltyType.hasValidity || link?.hasValidity ? formatDate(item.fromDate) : "",
    "Fecha hasta": item.noveltyType.hasValidity || link?.hasValidity ? formatDate(item.toDate) : "",
    sourceId: item.id,
    employeeId: item.employeeId,
    employeeName: `${item.employee.lastName}, ${item.employee.firstName}`,
    detail: item.noveltyType.name,
  };
}

function escapeCsv(value: string) {
  if (/[",\r\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: FinnegansExportRow[]) {
  const headers: (keyof FinnegansExportRow)[] = [
    "Legajo",
    "Novedad",
    "Centro de costo",
    "Valor 1",
    "Fecha Aplicación",
    "Fecha desde",
    "Fecha hasta",
  ];
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => escapeCsv(row[header] || "")).join(";"))].join("\r\n");
}

export const finnegansExportService = {
  async getRows(query: FinnegansExportQuery, audit?: AuditContext) {
    const novelties = await finnegansExportRepository.findExportableNovelties(query);
    const rows = novelties.map(toExportRow).filter((row) => row.Novedad);

    await auditService.register({
      ...audit,
      action: "EXPORT",
      entity: "FinnegansExport",
      description: `Se preparo exportacion Finnegans con ${rows.length} registros.`,
      after: { query, totalRows: rows.length } as Prisma.InputJsonValue,
    });

    return {
      total: rows.length,
      rows,
    };
  },
};
