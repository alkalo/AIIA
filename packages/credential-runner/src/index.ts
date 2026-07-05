#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { connectAndSaveSession } from "@aiia/scraper";

function parseArgs() {
  const args = process.argv.slice(2);
  let siteId = "";
  let loginUrl = "";
  let username = "";
  let password = "";
  let dataDir = join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "AIIA");
  let headed = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--site-id") siteId = args[++i];
    else if (args[i] === "--login-url") loginUrl = args[++i];
    else if (args[i] === "--username") username = args[++i];
    else if (args[i] === "--password") password = args[++i];
    else if (args[i] === "--data-dir") dataDir = args[++i];
    else if (args[i] === "--headless") headed = false;
  }

  if (!siteId || !loginUrl || !username) {
    console.error(
      "Usage: node index.js --site-id ID --login-url URL --username USER [--password PASS] [--data-dir DIR]"
    );
    process.exit(1);
  }

  return { siteId, loginUrl, username, password, dataDir, headed };
}

async function main() {
  const { siteId, loginUrl, username, password, dataDir, headed } = parseArgs();
  const sessionPath = join(dataDir, "sessions", `${siteId}.json`);

  const result = await connectAndSaveSession({
    loginUrl,
    username,
    password,
    sessionPath,
    headed,
  });

  if (!result.success) {
    console.log(JSON.stringify({ success: false, error: result.error }));
    process.exit(1);
  }

  const indexPath = join(dataDir, "credential-index.json");
  await mkdir(dataDir, { recursive: true });
  let index: Record<string, { sessionPath: string; loginUrl: string }> = {};
  try {
    const { readFile } = await import("node:fs/promises");
    index = JSON.parse(await readFile(indexPath, "utf-8")) as typeof index;
  } catch {
    /* new index */
  }
  index[siteId] = { sessionPath, loginUrl };
  await writeFile(indexPath, JSON.stringify(index, null, 2));

  console.log(JSON.stringify({ success: true, sessionPath, siteId }));
}

main();
