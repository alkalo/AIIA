import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentSpec, ExtractedItem } from "./types.js";
import {
  buildEmlDraft,
  composeNewsletterWrap,
  isNewsletterWrapTarget,
} from "./newsletter.js";

function expandPath(path: string): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return path.replace("%USERPROFILE%", home).replace("~/", `${home}/`);
}

export interface ExportPaths {
  inboxPath?: string;
  csvPath?: string;
  excelPath?: string;
  reportPath?: string;
  newsletterPath?: string;
  emailPath?: string;
}

export async function exportResults(
  items: ExtractedItem[],
  spec: AgentSpec,
  dataDir: string,
  runId?: string
): Promise<ExportPaths> {
  const destinations = spec.output.destinations;
  const paths: ExportPaths = {};
  const schema =
    spec.output.schema.length > 0
      ? spec.output.schema
      : ["title", "url", "snippet", "score", "reason"];

  const stamp = runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const wantWrap =
    destinations.includes("email") || isNewsletterWrapTarget(spec);

  let wrapBody: string | undefined;
  if (wantWrap && items.length > 0) {
    wrapBody = composeNewsletterWrap(items, spec);
    const wrapDir = join(dataDir, "exports", "newsletters");
    await mkdir(wrapDir, { recursive: true });
    paths.newsletterPath = join(wrapDir, `${spec.id}-${stamp}.txt`);
    await writeFile(paths.newsletterPath, wrapBody, "utf-8");
  }

  if (destinations.includes("email") && wrapBody) {
    const emailDir = join(dataDir, "exports", "email-drafts");
    await mkdir(emailDir, { recursive: true });
    const month = new Date().toLocaleString("en-AU", { month: "long", year: "numeric" });
    const eml = buildEmlDraft({
      subject: `${month} wrap-up: Grants & impact news — ${spec.name}`,
      body: wrapBody,
      to: spec.output.emailTo,
    });
    paths.emailPath = join(emailDir, `${spec.id}-${stamp}.eml`);
    await writeFile(paths.emailPath, eml, "utf-8");
  }

  if (destinations.includes("inbox") || items.length > 0) {
    const inboxDir = join(dataDir, "inbox", spec.id);
    await mkdir(inboxDir, { recursive: true });
    paths.inboxPath = join(inboxDir, `${stamp}.json`);
    await writeFile(
      paths.inboxPath,
      JSON.stringify(
        {
          agentId: spec.id,
          agentName: spec.name,
          runId: runId ?? stamp,
          exportedAt: new Date().toISOString(),
          count: items.length,
          schema,
          results: items,
          newsletterPath: paths.newsletterPath,
          emailPath: paths.emailPath,
        },
        null,
        2
      ),
      "utf-8"
    );
    paths.reportPath = join(inboxDir, `${stamp}-report.json`);
    await writeFile(
      paths.reportPath,
      JSON.stringify(
        {
          agentId: spec.id,
          runId: runId ?? stamp,
          count: items.length,
          topResults: items.slice(0, 5).map((i) => ({
            title: i.title,
            url: i.url,
            score: i.score,
          })),
          newsletterPath: paths.newsletterPath,
          emailPath: paths.emailPath,
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  if (destinations.includes("csv") || destinations.includes("inbox")) {
    paths.csvPath = join(dataDir, "exports", `${spec.id}.csv`);
    await mkdir(dirname(paths.csvPath), { recursive: true });
    await exportCsv(items, schema, paths.csvPath);
  }

  if (destinations.includes("excel")) {
    paths.excelPath = expandPath(
      spec.output.excelPath ?? join(dataDir, "exports", `${spec.name}.xlsx`)
    );
    await mkdir(dirname(paths.excelPath), { recursive: true });
    await exportExcel(items, schema, paths.excelPath, spec.output.excelMode === "update_same");
  }

  return paths;
}

async function exportCsv(items: ExtractedItem[], schema: string[], path: string): Promise<void> {
  const header = schema.join(",");
  const rows = items.map((item) =>
    schema.map((field) => `"${String(item[field] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  await writeFile(path, [header, ...rows].join("\n"), "utf-8");
}

async function exportExcel(
  items: ExtractedItem[],
  schema: string[],
  path: string,
  updateSame: boolean
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet;

  if (updateSame) {
    try {
      await workbook.xlsx.readFile(path);
      sheet = workbook.getWorksheet("Results") ?? workbook.addWorksheet("Results");
      sheet.spliceRows(2, sheet.rowCount);
    } catch {
      sheet = workbook.addWorksheet("Results");
      sheet.addRow(schema);
    }
  } else {
    sheet = workbook.addWorksheet("Results");
    sheet.addRow(schema);
  }

  if (sheet.rowCount === 0) sheet.addRow(schema);
  for (const item of items) {
    sheet.addRow(schema.map((field) => item[field] ?? ""));
  }

  await workbook.xlsx.writeFile(path);
}
