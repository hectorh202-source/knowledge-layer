import * as fs from "fs";
import * as path from "path";

/**
 * Checks that the docs have not drifted from the code.
 *
 *   npm run docs:check
 *
 * Only mechanical claims — script names, file paths, links, environment
 * variables. It cannot tell whether the prose is true, but those are not the
 * ways documentation usually rots. It rots because a script gets renamed and
 * six months later someone runs a command that no longer exists and concludes
 * the whole document is untrustworthy.
 *
 * Exits non-zero so it can be wired into CI.
 */

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");

interface Problem {
  file: string;
  message: string;
}

const problems: Problem[] = [];
const note = (file: string, message: string): void => {
  problems.push({ file, message });
};

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function docFiles(): string[] {
  return fs
    .readdirSync(DOCS)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(DOCS, name));
}

// --- npm scripts ------------------------------------------------------------

function checkScripts(): void {
  const pkg = JSON.parse(read(path.join(ROOT, "package.json"))) as {
    scripts: Record<string, string>;
  };
  const reference = read(path.join(DOCS, "reference.md"));

  for (const name of Object.keys(pkg.scripts)) {
    if (!reference.includes(`npm run ${name}`)) {
      note("reference.md", `npm script "${name}" exists but is not documented`);
    }
  }

  // And the reverse: a documented command that no longer exists sends someone
  // chasing a script that was renamed.
  for (const match of reference.matchAll(/npm run ([a-z0-9:-]+)/g)) {
    if (!pkg.scripts[match[1]]) {
      note("reference.md", `documents "npm run ${match[1]}", which is not in package.json`);
    }
  }

  // Every script must point at a file that exists.
  for (const [name, command] of Object.entries(pkg.scripts)) {
    const target = command.match(/(?:tsx|node)\s+([^\s]+\.(?:ts|mjs|js))/);
    if (target && !fs.existsSync(path.join(ROOT, target[1]))) {
      note("package.json", `script "${name}" runs ${target[1]}, which does not exist`);
    }
  }
}

// --- source paths mentioned in prose ---------------------------------------

function checkSourcePaths(): void {
  for (const file of docFiles()) {
    const name = path.basename(file);
    const text = read(file);

    // Backticked paths that look like real files: src/..., scripts/..., etc.
    for (const match of text.matchAll(/`((?:src|scripts|supabase|content)\/[^`\s]+\.[a-z]+)`/g)) {
      if (!fs.existsSync(path.join(ROOT, match[1]))) {
        note(name, `references ${match[1]}, which does not exist`);
      }
    }
  }
}

// --- links between docs -----------------------------------------------------

function checkLinks(): void {
  for (const file of docFiles()) {
    const name = path.basename(file);
    const text = read(file);

    for (const match of text.matchAll(/\]\((?!https?:)([^)#]+)(#[^)]*)?\)/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(target)) {
        note(name, `links to ${match[1]}, which does not exist`);
      }
    }
  }
}

// --- environment variables --------------------------------------------------

function checkEnv(): void {
  const example = path.join(ROOT, ".env.example");
  if (!fs.existsSync(example)) {
    note(".env.example", "missing — setup.md tells people to copy it");
    return;
  }

  const setup = read(path.join(DOCS, "setup.md"));

  for (const line of read(example).split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match && !setup.includes(match[1])) {
      note("setup.md", `${match[1]} is in .env.example but not documented`);
    }
  }
}

// --- a real key must never reach .env.example -------------------------------

function checkNoSecrets(): void {
  const example = path.join(ROOT, ".env.example");
  if (!fs.existsSync(example)) return;

  for (const line of read(example).split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
    if (!match) continue;
    const value = match[2].trim();
    // Anything that looks like a credential rather than a placeholder. This has
    // happened once already — a key was pasted into the example file and then
    // copied into .env by someone following the setup instructions.
    if (value.length > 12 && !value.includes(" ") && !value.startsWith("#")) {
      note(".env.example", `${match[1]} appears to hold a real value — it must be empty`);
    }
  }
}

function main(): void {
  if (!fs.existsSync(DOCS)) {
    process.stderr.write("No docs/ directory.\n");
    process.exit(1);
  }

  checkScripts();
  checkSourcePaths();
  checkLinks();
  checkEnv();
  checkNoSecrets();

  const files = docFiles().length;

  if (problems.length === 0) {
    process.stdout.write(`\nDocs check: ${files} file(s), no drift found.\n\n`);
    return;
  }

  process.stdout.write(`\nDocs check: ${problems.length} problem(s)\n\n`);
  for (const problem of problems) {
    process.stdout.write(`  ${problem.file}\n    ${problem.message}\n`);
  }
  process.stdout.write(
    `\nSee docs/maintaining.md. A change is not finished until the docs match it.\n\n`
  );
  process.exit(1);
}

main();
