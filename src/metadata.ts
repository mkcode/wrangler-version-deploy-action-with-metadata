import * as core from "@actions/core";
import * as exec from "@actions/exec";

export interface DeployMetadata {
  // GitHub repository & commit context
  owner?: string;
  repo?: string;
  ref?: string;
  branch?: string;
  sha?: string;
  short_sha?: string;

  // GitHub Actions runtime context
  actor?: string;
  run_id?: string;
  run_number?: string;

  // Commit messages
  commit_message?: string;
  short_commit_message?: string;
}

/**
 * Collects metadata from the GitHub Actions environment and local git.
 * This information is used for rendering message and tag templates.
 */
export async function collectDeployMetadata(): Promise<DeployMetadata> {
  const repoFull = process.env.GITHUB_REPOSITORY;
  const [owner, repo] = repoFull ? repoFull.split("/") : [undefined, undefined];

  const sha = process.env.GITHUB_SHA;
  const short_sha = sha ? sha.substring(0, 7) : undefined;

  const ref = process.env.GITHUB_REF;
  const branch =
    ref && ref.startsWith("refs/heads/") ? ref.replace("refs/heads/", "") : undefined;

  const actor = process.env.GITHUB_ACTOR;
  const run_id = process.env.GITHUB_RUN_ID;
  const run_number = process.env.GITHUB_RUN_NUMBER;

  const commit_message = await getLastCommitMessage();
  const short_commit_message = commit_message
    ? commit_message.split("\n")[0].trim()
    : undefined;

  const metadata: DeployMetadata = {
    owner,
    repo,
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

  debugMetadata(metadata);

  return metadata;
}

/**
 * Fetches the last commit message on the current HEAD.
 * Falls back gracefully if git is unavailable.
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
  } catch (error) {
    core.debug(
      `Unable to read commit message via git log -1 --pretty=%B: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

/**
 * Emits debug logging for collected metadata to aid troubleshooting
 * without leaking secrets or noisy information.
 */
function debugMetadata(metadata: DeployMetadata): void {
  core.debug(
    [
      "Collected deploy metadata:",
      `  owner: ${metadata.owner ?? "n/a"}`,
      `  repo: ${metadata.repo ?? "n/a"}`,
      `  ref: ${metadata.ref ?? "n/a"}`,
      `  branch: ${metadata.branch ?? "n/a"}`,
      `  sha: ${metadata.sha ?? "n/a"}`,
      `  short_sha: ${metadata.short_sha ?? "n/a"}`,
      `  actor: ${metadata.actor ?? "n/a"}`,
      `  run_id: ${metadata.run_id ?? "n/a"}`,
      `  run_number: ${metadata.run_number ?? "n/a"}`,
      `  commit_message: ${
        metadata.commit_message
          ? truncateForDebug(metadata.commit_message, 140)
          : "n/a"
      }`,
      `  short_commit_message: ${
        metadata.short_commit_message
          ? truncateForDebug(metadata.short_commit_message, 140)
          : "n/a"
      }`,
    ].join("\n")
  );
}

/**
 * Truncates a string for safe debug output.
 */
function truncateForDebug(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}
