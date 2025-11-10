import * as core from "@actions/core";
import * as exec from "@actions/exec";

type TemplateContext = Record<string, string | undefined>;

interface ParsedWranglerOutput {
  deploymentUrl?: string;
  versionId?: string;
}

async function run(): Promise<void> {
  try {
    const apiToken = core.getInput("api_token", { required: true });
    const wranglerCommand = core.getInput("wrangler_command") || "deploy";
    const wranglerArgsRaw = core.getInput("wrangler_args") || "";
    const messageTemplate = core.getInput("message_template") || "";
    const tagTemplate = core.getInput("tag_template") || "";

    if (!apiToken) {
      core.setFailed("Cloudflare API token (api_token) is required.");
      return;
    }

    // Collect metadata from the GitHub environment and git.
    const metadata = await collectMetadata();

    // Log basic context for transparency (no secrets).
    core.info(
      [
        `Repository: ${metadata.owner ?? "unknown"}/${metadata.repo ?? "unknown"}`,
        `Branch: ${metadata.branch ?? metadata.ref ?? "unknown"}`,
        `SHA: ${metadata.sha ?? "unknown"}`,
        `Actor: ${metadata.actor ?? "unknown"}`,
        `Run: #${metadata.run_number ?? "?"} (ID: ${metadata.run_id ?? "?"})`,
      ].join(" | "),
    );

    // Prepare Wrangler invocation.
    // We assume `wrangler` is available in PATH (documented requirement).
    const wranglerArgs = splitArgs(wranglerArgsRaw);

    core.info(`Running: wrangler ${[wranglerCommand, ...wranglerArgs].join(" ")}`);

    let stdOut = "";
    let stdErr = "";

    const execOptions: exec.ExecOptions = {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      listeners: {
        stdout: (data: Buffer) => {
          const text = data.toString();
          stdOut += text;
          core.info(text.trimEnd());
        },
        stderr: (data: Buffer) => {
          const text = data.toString();
          stdErr += text;
          // Keep stderr visible to aid debugging but avoid leaking secrets.
          core.error(text.trimEnd());
        },
      },
    };

    const exitCode = await exec.exec(
      "wrangler",
      [wranglerCommand, ...wranglerArgs],
      execOptions,
    );

    if (exitCode !== 0) {
      core.setFailed(
        `Wrangler command failed with exit code ${exitCode}. See logs above for details.`,
      );
      return;
    }

    const { deploymentUrl, versionId } = parseWranglerOutput(stdOut);

    if (deploymentUrl) {
      core.info(`Detected deployment URL: ${deploymentUrl}`);
      core.setOutput("deployment_url", deploymentUrl);
    } else {
      core.info(
        "No deployment URL detected from Wrangler output. If this is unexpected, please open an issue with example logs.",
      );
    }

    if (versionId) {
      core.info(`Detected deployment version/ID: ${versionId}`);
      core.setOutput("version_id", versionId);
    }

    const templateContext: TemplateContext = {
      ...metadata,
      deployment_url: deploymentUrl,
      version_id: versionId,
    };

    const renderedMessage = messageTemplate
      ? renderTemplate(messageTemplate, templateContext)
      : "";
    const renderedTag = tagTemplate
      ? renderTemplate(tagTemplate, templateContext)
      : "";

    if (renderedMessage) {
      core.info(`Rendered deployment message: ${renderedMessage}`);
      core.setOutput("message", renderedMessage);
    }

    if (renderedTag) {
      core.info(`Rendered deployment tag: ${renderedTag}`);
      core.setOutput("tag", renderedTag);
    }
  } catch (unknownError) {
    const error = toError(unknownError);
    core.setFailed(error.message || String(error));
  }
}

/**
 * Collect GitHub Actions + git metadata used for templating.
 */
async function collectMetadata(): Promise<{
  repo?: string;
  owner?: string;
  ref?: string;
  branch?: string;
  sha?: string;
  short_sha?: string;
  actor?: string;
  run_id?: string;
  run_number?: string;
  commit_message?: string;
  short_commit_message?: string;
}> {
  const repoFull = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repoFull ? repoFull.split("/") : [undefined, undefined];

  const sha = process.env.GITHUB_SHA;
  const short_sha = sha ? sha.substring(0, 7) : undefined;

  const ref = process.env.GITHUB_REF;
  const branch = ref && ref.startsWith("refs/heads/")
    ? ref.substring("refs/heads/".length)
    : undefined;

  const actor = process.env.GITHUB_ACTOR;
  const run_id = process.env.GITHUB_RUN_ID;
  const run_number = process.env.GITHUB_RUN_NUMBER;

  const commit_message = await getLastCommitMessage();
  const short_commit_message = commit_message
    ? commit_message.split("\n")[0]
    : undefined;

  return {
    repo: repoName,
    owner,
    ref,
    branch,
    sha,
    short_sha,
    actor,
    run_id,
    run_number,
    commit_message,
    short_commit_message,
  };
}

/**
 * Get the last commit message from git, if available.
 */
async function getLastCommitMessage(): Promise<string | undefined> {
  try {
    let message = "";
    await exec.exec("git", ["log", "-1", "--pretty=%B"], {
      listeners: {
        stdout: (data: Buffer) => {
          message += data.toString();
        },
      },
      silent: true,
    });
    const trimmed = message.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    // If git is not available or this fails, just return undefined.
    return undefined;
  }
}

/**
 * Render a simple {{var}} template string from a context object.
 *
 * Unknown variables are rendered as empty strings to keep messages clean.
 */
function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    const value = context[key];
    return value !== undefined ? String(value) : "";
  });
}

/**
 * Split a raw argument string into an argv array.
 * Handles basic quoting; this is intentionally simple but robust enough
 * for typical flag usage (`--env production`, etc).
 */
function splitArgs(raw: string): string[] {
  if (!raw.trim()) return [];

  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Best-effort parsing of Wrangler v4 output to extract a deployment URL and version ID.
 *
 * This is intentionally conservative. As we refine our understanding of Wrangler's
 * structured output, we can tighten this logic.
 */
function parseWranglerOutput(output: string): ParsedWranglerOutput {
  const result: ParsedWranglerOutput = {};

  // Heuristic: first URL-looking token is likely the deployment URL.
  // Matches http(s)://..., stopping at whitespace or quotes.
  const urlMatch = output.match(/https?:\/\/[^\s"]+/);
  if (urlMatch) {
    result.deploymentUrl = urlMatch[0];
  }

  // Heuristic: look for "version" tokens (e.g., "version abc123") and capture the ID.
  const versionMatch = output.match(/\bversion\b[:\s]+([A-Za-z0-9._-]+)/i);
  if (versionMatch) {
    result.versionId = versionMatch[1];
  }

  return result;
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(typeof e === "string" ? e : "Unknown error");
}

void run();
