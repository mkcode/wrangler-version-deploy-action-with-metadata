import * as core from "@actions/core";
import * as exec from "@actions/exec";

type TemplateContext = Record<string, string | undefined>;

interface ParsedWranglerOutput {
  deploymentUrl?: string;
  versionId?: string;
}

interface DeployMetadata {
  owner?: string;
  repo?: string;
  ref?: string;
  branch?: string;
  sha?: string;
  short_sha?: string;
  actor?: string;
  run_id?: string;
  run_number?: string;
  commit_message?: string;
  short_commit_message?: string;
}

async function run(): Promise<void> {
  try {
    const apiToken = core.getInput("api_token", { required: true });
    const wranglerCommandInput = core.getInput("wrangler_command", {
      required: true,
    });
    const workingDirectoryInput = core.getInput("working_directory") || "";
    const onlyUploadInput = core.getInput("only_upload") || "false";
    const onlyUpload = onlyUploadInput.toLowerCase() === "true";
    const config = core.getInput("config", { required: true });
    const uploadArgsRaw = core.getInput("upload_args") || "";
    const deployArgsRaw = core.getInput("deploy_args") || "";
    const messageTemplate = core.getInput("message_template") || "";
    const tagTemplate = core.getInput("tag_template") || "";

    const uploadArgsList = splitArgs(uploadArgsRaw);
    const deployArgsList = splitArgs(deployArgsRaw);

    const workingDirectory =
      workingDirectoryInput.trim().length > 0
        ? workingDirectoryInput.trim()
        : undefined;

    const wranglerCommand = wranglerCommandInput.trim();

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

    // Prepare Wrangler args from inputs (already parsed above).

    // 1) Build message and tag from templates + metadata (no deployment data yet).
    const preTemplateContext: TemplateContext = {
      ...metadata,
      deployment_url: undefined,
      version_id: undefined,
    };

    const renderedMessage = messageTemplate
      ? renderTemplate(messageTemplate, preTemplateContext)
      : buildDefaultMessage(metadata);
    const renderedTag = tagTemplate
      ? renderTemplate(tagTemplate, preTemplateContext)
      : buildDefaultTag(metadata);

    core.info(`Using deployment message: ${renderedMessage}`);
    if (renderedTag) {
      core.info(`Using deployment tag: ${renderedTag}`);
    }

    // 2) Run `wrangler versions upload` to create a new version with metadata.
    // We assume the user is on Wrangler v4+ and that `versions` commands are available.
    // The actual Worker configuration (e.g. wrangler.toml) is controlled by the caller.
    const uploadArgs = [
      "versions",
      "upload",
      "--config",
      config,
      ...uploadArgsList,
      `--message=${renderedMessage}`,
    ];

    core.info(`Running upload: ${wranglerCommand} ${uploadArgs.join(" ")}`);

    let uploadStdout = "";
    let uploadStderr = "";

    const uploadOptions: exec.ExecOptions = {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      cwd: workingDirectory,
      listeners: {
        stdout: (data: Buffer) => {
          const text = data.toString();
          uploadStdout += text;
          core.info(text.trimEnd());
        },
        stderr: (data: Buffer) => {
          const text = data.toString();
          uploadStderr += text;
          core.error(text.trimEnd());
        },
      },
    };

    const uploadExitCode = await exec.exec(
      wranglerCommand,
      uploadArgs,
      uploadOptions,
    );

    if (uploadExitCode !== 0) {
      core.setFailed(
        `wrangler versions upload failed with exit code ${uploadExitCode}. See logs above for details.`,
      );
      return;
    }

    const versionId = parseVersionIdFromUpload(uploadStdout);

    if (onlyUpload) {
      if (versionId) {
        core.info(`Parsed Worker Version ID (only_upload=true): ${versionId}`);
        core.setOutput("version_id", versionId);
      } else {
        core.info(
          "only_upload=true and no Worker Version ID could be parsed; exiting successfully.",
        );
      }

      if (renderedMessage) {
        core.setOutput("message", renderedMessage);
      }
      if (renderedTag) {
        core.setOutput("tag", renderedTag);
      }

      return;
    }

    if (!versionId) {
      core.setFailed(
        "Failed to parse Worker Version ID from wrangler versions upload output.",
      );
      return;
    }
    core.info(`Parsed Worker Version ID: ${versionId}`);

    // 3) Run `wrangler versions deploy <versionId>` non-interactively with the same message.
    const deployArgs = [
      "versions",
      "deploy",
      versionId,
      "-y",
      "--config",
      config,
      ...deployArgsList,
      `--message=${renderedMessage}`,
    ];

    core.info(`Running deploy: ${wranglerCommand} ${deployArgs.join(" ")}`);

    let deployStdout = "";
    let deployStderr = "";

    const deployOptions: exec.ExecOptions = {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      cwd: workingDirectory,
      listeners: {
        stdout: (data: Buffer) => {
          const text = data.toString();
          deployStdout += text;
          core.info(text.trimEnd());
        },
        stderr: (data: Buffer) => {
          const text = data.toString();
          deployStderr += text;
          core.error(text.trimEnd());
        },
      },
    };

    const deployExitCode = await exec.exec(
      wranglerCommand,
      deployArgs,
      deployOptions,
    );

    if (deployExitCode !== 0) {
      core.setFailed(
        `wrangler versions deploy failed with exit code ${deployExitCode}. See logs above for details.`,
      );
      return;
    }

    const { deploymentUrl } = parseWranglerOutput(deployStdout);

    if (deploymentUrl) {
      core.info(`Detected deployment URL: ${deploymentUrl}`);
      core.setOutput("deployment_url", deploymentUrl);
    } else {
      core.info(
        "No deployment URL detected from Wrangler deploy output. If this is unexpected, please open an issue with example logs.",
      );
    }

    // Expose core metadata outputs for downstream steps.
    core.setOutput("version_id", versionId);
    if (renderedMessage) {
      core.setOutput("message", renderedMessage);
    }
    if (renderedTag) {
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
async function collectMetadata(): Promise<DeployMetadata> {
  const repoFull = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repoFull
    ? repoFull.split("/")
    : [undefined, undefined];

  const sha = process.env.GITHUB_SHA;
  const short_sha = sha ? sha.substring(0, 7) : undefined;

  const ref = process.env.GITHUB_REF;
  const branch =
    ref && ref.startsWith("refs/heads/")
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
  return template.replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (_match, key: string) => {
      const value = context[key];
      return value !== undefined ? String(value) : "";
    },
  );
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
 * Parse deployment URL from Wrangler output.
 * This remains a best-effort heuristic until we rely on a stable structured format.
 */
function parseWranglerOutput(output: string): ParsedWranglerOutput {
  const result: ParsedWranglerOutput = {};

  // Heuristic: first URL-looking token is likely the deployment URL.
  const urlMatch = output.match(/https?:\/\/[^\s"]+/);
  if (urlMatch) {
    result.deploymentUrl = urlMatch[0];
  }

  return result;
}

/**
 * Parse Worker Version ID from `wrangler versions upload` output.
 * Mirrors the behavior from the standalone deploy-cloudflare-version script.
 */
function parseVersionIdFromUpload(output: string): string | undefined {
  const match = output.match(/Worker Version ID:\s*([0-9a-fA-F-]+)/);
  return match?.[1];
}

/**
 * Build a simple default message when no explicit template is provided.
 * Format: branch@sha6: first-line-of-commit-message (trimmed).
 */
function buildDefaultMessage(meta: DeployMetadata): string {
  const branch = meta.branch || "";
  const shortSha = meta.short_sha || (meta.sha ? meta.sha.substring(0, 6) : "");
  const baseMessage = meta.short_commit_message || meta.commit_message || "";

  const prefixParts: string[] = [];
  if (branch) {
    if (shortSha) {
      prefixParts.push(`${branch}@${shortSha}`);
    } else {
      prefixParts.push(branch);
    }
  } else if (shortSha) {
    prefixParts.push(shortSha);
  }

  const prefix = prefixParts.join("");
  const combined = prefix ? `${prefix}: ${baseMessage}` : baseMessage;

  return combined.slice(0, 100);
}

/**
 * Build a compact default tag when no tag_template is provided.
 * By default, this action does not generate a tag, so this returns an empty string.
 */
function buildDefaultTag(_meta: DeployMetadata): string {
  return "";
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(typeof e === "string" ? e : "Unknown error");
}

void run();
