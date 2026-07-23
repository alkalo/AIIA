import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentSpec, ExtractedItem } from "./types.js";
import {
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
  /** @deprecated No longer written — copy-paste .txt only */
  emailPath?: string;
}

/** Optional run meta persisted into inbox + report JSON for Inbox / debugging. */
export interface ExportRunMeta {
  sourceHealth?: string;
  regionCoverage?: string[];
  regionGaps?: string[];
  serpExhausted?: boolean;
  listingExpandCount?: number;
  depth2Count?: number;
  feedItemCount?: number;
  seedCount?: number;
  gapFillCount?: number;
  /** Per-engine SERP hit counts (brave-api vs brave HTML, etc.). */
  serpEngineHits?: Record<string, number>;
  portalParserCount?: number;
  portalDetailCount?: number;
  feedSkippedCount?: number;
  feedFailCount?: number;
  /** Finals by discovery channel (rss / portal-seed / serp / …). */
  originCounts?: Record<string, number>;
}

export async function exportResults(
  items: ExtractedItem[],
  spec: AgentSpec,
  dataDir: string,
  runId?: string,
  meta?: ExportRunMeta
): Promise<ExportPaths> {
  const destinations = spec.output.destinations;
  const paths: ExportPaths = {};
  const schema =
    spec.output.schema.length > 0
      ? spec.output.schema
      : ["title", "url", "snippet", "score", "reason"];

  const stamp = runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const wantWrap = isNewsletterWrapTarget(spec);

  let wrapBody: string | undefined;
  if (wantWrap && items.length > 0) {
    wrapBody = composeNewsletterWrap(items, spec);
    const wrapDir = join(dataDir, "exports", "newsletters");
    await mkdir(wrapDir, { recursive: true });
    paths.newsletterPath = join(wrapDir, `${spec.id}-${stamp}.txt`);
    await writeFile(paths.newsletterPath, wrapBody, "utf-8");
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
          copyPasteOnly: true,
          runMeta: meta ?? undefined,
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
          copyPasteOnly: true,
          sourceHealth: meta?.sourceHealth,
          regionCoverage: meta?.regionCoverage,
          regionGaps: meta?.regionGaps,
          serpExhausted: meta?.serpExhausted,
          listingExpandCount: meta?.listingExpandCount,
          depth2Count: meta?.depth2Count,
          feedItemCount: meta?.feedItemCount,
          seedCount: meta?.seedCount,
          gapFillCount: meta?.gapFillCount,
          serpEngineHits: meta?.serpEngineHits,
          portalParserCount: meta?.portalParserCount,
          portalDetailCount: meta?.portalDetailCount,
          feedSkippedCount: meta?.feedSkippedCount,
          feedFailCount: meta?.feedFailCount,
          originCounts: meta?.originCounts,
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
