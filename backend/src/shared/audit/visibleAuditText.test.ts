import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regresión global (no snapshots puntuales): recorre TODO el backend y falla
 * si un texto visible de auditoría o notificación interpola un id técnico
 * (`id`, `employeeId`, `item.employeeId`, `before.userId`, `entityId`...).
 * Esos textos se muestran tal cual en Dashboard > Actividad reciente,
 * Auditoría, Historial del legajo y Notificaciones. La identidad humana sale
 * de shared/audit/employeeReference.ts.
 */

const SRC_ROOT = join(__dirname, "..", "..");
const VISIBLE_KEYS = new Set(["description", "title", "message"]);
const TECHNICAL_ID_NAME = /^(id|.*Id)$/;
// Métodos de string que devuelven el mismo valor visible: se mira su receptor.
const PASSTHROUGH_METHODS = new Set(["toString", "trim", "slice", "toUpperCase", "toLowerCase"]);

type Finding = { file: string; line: number; key: string; expression: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function isVisibleTextSink(call: ts.CallExpression) {
  const callee = call.expression.getText();
  return /(^|\.)auditService\.register$/.test(callee)
    || /(^|\.)(notifyUsers|notifyRrhh)$/.test(callee)
    || /\.systemNotification\.(create|createMany|update|upsert)$/.test(callee);
}

// Expresiones cuyo valor termina renderizado en el texto. Las llamadas
// (formatEmployeeReference(x), humanizePeriodEs(p)...) devuelven texto ya
// formateado: no se mira adentro, salvo métodos de string que pasan el valor.
function renderedTechnicalIds(node: ts.Node): ts.Node[] {
  if (ts.isIdentifier(node)) return TECHNICAL_ID_NAME.test(node.text) ? [node] : [];
  if (ts.isPropertyAccessExpression(node)) return TECHNICAL_ID_NAME.test(node.name.text) ? [node] : [];
  if (ts.isElementAccessExpression(node)) return [];
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && PASSTHROUGH_METHODS.has(callee.name.text)) return renderedTechnicalIds(callee.expression);
    return [];
  }
  if (ts.isTemplateExpression(node)) return node.templateSpans.flatMap((span) => renderedTechnicalIds(span.expression));
  if (ts.isConditionalExpression(node)) return [...renderedTechnicalIds(node.whenTrue), ...renderedTechnicalIds(node.whenFalse)];
  if (ts.isBinaryExpression(node)) return [...renderedTechnicalIds(node.left), ...renderedTechnicalIds(node.right)];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return renderedTechnicalIds(node.expression);
  return [];
}

function findTechnicalIdsInVisibleText(fileName: string, source: string) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  let sinks = 0;

  const inspectSinkArgument = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && VISIBLE_KEYS.has(node.name.text)) {
      for (const leak of renderedTechnicalIds(node.initializer)) {
        findings.push({
          file: fileName,
          line: sourceFile.getLineAndCharacterOfPosition(leak.getStart()).line + 1,
          key: node.name.text,
          expression: leak.getText(),
        });
      }
    }
    // Sólo se baja por la forma del argumento (objetos, arrays, map(...) de
    // createMany), nunca dentro de los textos ya inspeccionados.
    if (!ts.isPropertyAssignment(node) || !VISIBLE_KEYS.has(node.name.getText())) ts.forEachChild(node, inspectSinkArgument);
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isVisibleTextSink(node)) {
      sinks += 1;
      node.arguments.forEach(inspectSinkArgument);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sinks, findings };
}

describe("textos visibles de auditoría/notificaciones — nunca un id técnico", () => {
  it("ningún auditService.register / notifyUsers / notifyRrhh / systemNotification del backend interpola un id", () => {
    let sinks = 0;
    const findings: Finding[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const result = findTechnicalIdsInVisibleText(relative(SRC_ROOT, file), readFileSync(file, "utf8"));
      sinks += result.sinks;
      findings.push(...result.findings);
    }

    // Guarda contra un falso verde: el escaneo tiene que estar viendo los
    // llamados reales (hay más de cien en el backend).
    expect(sinks).toBeGreaterThan(100);
    expect(findings.map((finding) => `${finding.file}:${finding.line} ${finding.key} <- \${${finding.expression}}`)).toEqual([]);
  });

  it("detecta los patrones que filtraban el UUID (el escaneo no es vacuo)", () => {
    const source = `
      auditService.register({ description: \`Se guardó el desglose para el legajo \${employeeId}.\` });
      await auditService.register({ ...audit, description: ok ? \`(legajo \${item.employeeId})\` : "x" });
      await auditService.register({ description: "Se quitó el concepto del empleado " + before.employeeId.toString() });
      await notifyRrhh({ title: "Cierre", message: \`Usuario \${user.id}\` });
      await tx.systemNotification.createMany({ data: rows.map((row) => ({ title: "x", message: \`ver \${row.entityId}\` })) });
    `;
    const { findings } = findTechnicalIdsInVisibleText("fixture.ts", source);
    expect(findings.map((finding) => finding.expression)).toEqual([
      "employeeId",
      "item.employeeId",
      "before.employeeId",
      "user.id",
      "row.entityId",
    ]);
  });

  it("acepta identidad humana, conteos y formateadores (sin falsos positivos)", () => {
    const source = `
      auditService.register({
        entityId: item.id,
        description: \`Se habilitó el concepto para \${employeeIds.length} empleado(s) de \${formatEmployeeReference(item.employee)} (\${employeeReference(closure.employeeId)}).\`,
        after: { employeeId },
      });
    `;
    expect(findTechnicalIdsInVisibleText("fixture.ts", source).findings).toEqual([]);
  });
});
