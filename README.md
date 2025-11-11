# Wrangler Version Deploy Action with Metadata

Deploy Cloudflare Workers using Wrangler v4's Versions API while attaching rich, commit-aware metadata to each deployment.

This Action:

- Uses `wrangler versions upload` + `wrangler versions deploy` instead of plain `wrangler deploy`.
- Lets you define custom deployment messages (and an optional tag string) using templates.
- Exposes the Worker Version ID and deployment URL as outputs for downstream steps.
- Is designed for workflows where you build in GitHub Actions and want clean, traceable deploys in Cloudflare.

## When to use this instead of the official Cloudflare Action

### Use this Action if you need:

- Monorepo-friendly behavior. Selective path based deployments.
- Custom build pipelines. Build on GitHub actions.
- Strong, composable metadata around each version and deployment:

<img width="2168" height="886" alt="Zen-2025-11-10 at 21 04 46@2x" src="https://github.com/user-attachments/assets/27c329b9-dc68-438d-ba6e-a264bac14390" />

### The official Cloudflare Actions are great if:

- You want a quick, simple deploy with minimal control.
- You’re okay with less flexibility around build steps and monorepo layouts.

## Features

- Built for Wrangler v4 and Workers Versions.
- Uploads a specific Worker Version and (by default) deploys that exact version.
- Customizable deployment message via `message_template`.
- Optional tag string via `tag_template` (exposed as output for your own use).
- Outputs:
  - `version_id`: The Worker Version ID that was uploaded/deployed.
  - `deployment_url`: Best-effort deployment URL parsed from Wrangler output.
  - `message`: The final rendered message.
  - `tag`: The final rendered tag (if any).
- `only_upload` mode when you want to upload a version and deploy it separately.
- `wrangler_command` lets you control exactly how Wrangler is invoked (e.g. `wrangler`, `npx wrangler@4`, `pnpm dlx wrangler@4`).
- `working_directory` lets you target a specific folder in a monorepo when running Wrangler commands.

## How it works

Instead of calling:

- `wrangler deploy` (which does not accept rich message/tag metadata),

this Action performs:

1. Collect metadata from the GitHub Actions environment:
   - `owner`, `repo`
   - `ref`, `branch`
   - `sha`, `short_sha`
   - `actor`
   - `run_id`, `run_number`
   - `commit_message`, `short_commit_message`
2. Compute the deployment message:
   - If `message_template` is provided, render it using the metadata.
   - Otherwise, generate a default:
     - `branch@sha6: first-line-of-commit-message` (truncated to 100 chars).
3. Optionally compute a tag:
   - If `tag_template` is provided, render it using the same metadata.
   - By default, no tag is generated.
   - Note: this tag is not currently sent directly to Cloudflare; it’s exposed as an Action output for your own use.
4. Run:
   - `wrangler versions upload --config <config> [upload_args...] --message="<message>"`
5. Parse the Worker Version ID from the upload output.
6. If `only_upload` is `false` (default):
   - Run:
     - `wrangler versions deploy <versionId> -y --config <config> [deploy_args...] --message="<message>"`
   - Best-effort parse the deployment URL from the deploy output.
7. Expose:
   - `version_id`, `deployment_url`, `message`, and `tag` as outputs.

This upload-then-deploy flow is what enables meaningful messages to show up in Cloudflare’s deployment history.

## Requirements

You must:

- Use Wrangler v4 (Versions API support required).
- Ensure you have a reliable way to invoke Wrangler v4:
  - You specify this explicitly via the `wrangler_command` input.
  - Examples:
    - `wrangler`
    - `npx wrangler@4`
    - `pnpm dlx wrangler@4`
  - No separate install step is required if your `wrangler_command` handles it.
- Provide a Cloudflare API token:
  - With appropriate permissions for your Worker.
  - Passed via `secrets` to the `api_token` input.
- Provide the path to your Wrangler config file via the `config` input:
  - Example: `wrangler.toml`
  - Example: `dist/server/wrangler.json`
- Run this Action from (or pointing at) the correct Worker project:
  - Use `config` and the args inputs to ensure Wrangler targets the right project and environment.

This Action does NOT:

- Build your project.
- Install wrangler for you.
- Infer your Wrangler config automatically.
- Manage `account_id` for you (Wrangler should pick that up from config/env).

## Inputs

All inputs are strings (as per GitHub Actions) unless noted; booleans are passed as `"true"` / `"false"`.

- `api_token` (required)
  - Cloudflare API token.
  - Recommended: `secrets.CLOUDFLARE_API_TOKEN`.
  - Used to set `CLOUDFLARE_API_TOKEN` for the Wrangler commands.

- `wrangler_command` (required)
  - How to invoke Wrangler.
  - This is the base command (and optional leading arguments) that will be used for both upload and deploy.
  - Examples:
    - `wrangler`
    - `npx wrangler`
    - `pnpm dlx wrangler@4`
  - Then runs:
    - `<wrangler_command> versions upload ...`
    - `<wrangler_command> versions deploy ...`

- `working_directory` (optional)
  - Working directory from which Wrangler commands will be executed.
  - If set, it is used as the `cwd` for both:
    - `versions upload`
    - `versions deploy`
  - Useful for monorepos where your Worker lives in a subfolder.

- `config` (optional)
  - Path to the Wrangler configuration file.
  - When provided:
    - Passed as `--config <config>` to both:
      - `wrangler versions upload`
      - `wrangler versions deploy`
  - When omitted:
    - Wrangler's default configuration resolution is used (for example, a `wrangler.toml` in the working directory).

- `upload_args` (optional)
  - Extra arguments for:
    - `wrangler versions upload`
  - Do NOT include `--config` here; that comes from `config`.
  - Example:
    - `--env production`
  - Example command shape:
    - `wrangler versions upload --config <config> <upload_args...> --message="<message>"`

- `deploy_args` (optional)
  - Extra arguments for:
    - `wrangler versions deploy`
  - Do NOT include `--config` here; that comes from `config`.
  - Example:
    - `--env production`
  - Example command shape:
    - `wrangler versions deploy <versionId> -y --config <config> <deploy_args...> --message="<message>"`

- `message_template` (optional)
  - Template for the deployment message.
  - If not provided:
    - A default message based on branch, SHA, and commit message is used.
  - The same message is applied to both upload and deploy.
  - Supported placeholders:
    - `{{owner}}`
    - `{{repo}}`
    - `{{ref}}`
    - `{{branch}}`
    - `{{sha}}`
    - `{{short_sha}}`
    - `{{actor}}`
    - `{{run_id}}`
    - `{{run_number}}`
    - `{{commit_message}}`
    - `{{short_commit_message}}`
    - `{{deployment_url}}` (only meaningful when used with outputs / in later steps)
    - `{{version_id}}` (only meaningful when used with outputs / in later steps)

- `tag_template` (optional)
  - Template for a tag/label string derived from the same metadata.
  - If not provided:
    - No tag is generated (empty output).
  - Note:
    - Tags are NOT currently pushed directly into Cloudflare by this Action.
    - The rendered tag is available via the `tag` output for your own usage (e.g. PR comments, releases, logs).

- `only_upload` (optional, default: `"false"`)
  - `"false"` (default):
    - Full flow:
      - `wrangler versions upload ...`
      - Parse `version_id` (required).
      - `wrangler versions deploy <versionId> -y ...`
      - Best-effort parse `deployment_url`.
      - Fail if `version_id` cannot be parsed.
  - `"true"`:
    - Upload-only flow:
      - `wrangler versions upload ...`
      - Try to parse `version_id`:
        - If found → set `version_id` output.
        - If not found → log and still succeed.
      - Do NOT run `versions deploy`.
      - Useful if:
        - You deploy specific versions elsewhere, or want a manual approval step.

## Outputs

- `deployment_url`
  - Best-effort detected URL from `wrangler versions deploy` output.
  - Empty when `only_upload: "true"` or when no URL can be detected.

- `version_id`
  - Worker Version ID parsed from `wrangler versions upload` output.
  - Required for success when `only_upload: "false"`.
  - Optional when `only_upload: "true"`.

- `message`
  - The final rendered deployment message used for upload (and deploy, if applicable).

- `tag`
  - The final rendered tag string, if `tag_template` was provided.
  - Empty if no `tag_template` is set.

## Usage Examples

### Example 1: Upload + Deploy to Production

Use this when you:

- Build your Worker in CI.
- Want to upload and immediately deploy with a descriptive message.

```yaml
name: Deploy Worker (Production)

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Build your worker here
      # - run: pnpm install
      # - run: pnpm build

      # Ensure Wrangler v4 is available
      - run: pnpm dlx wrangler@4 --version

      - name: Upload + deploy via Wrangler Versions with metadata
        id: cf_deploy
        uses: mkcode/wrangler-version-deploy-action-with-metadata@v1
        with:
          api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          wrangler_command: "pnpm dlx wrangler@4"
          working_directory: "dist/server"
          config: "wrangler.json"
          upload_args: "--env production"
          deploy_args: "--env production"
          message_template: "Deployed {{repo}}@{{short_sha}} to {{branch}} by {{actor}} (run {{run_number}})"

      - name: Report deployment
        run: |
          echo "Version ID: ${{ steps.cf_deploy.outputs.version_id }}"
          echo "URL: ${{ steps.cf_deploy.outputs.deployment_url }}"
          echo "Message: ${{ steps.cf_deploy.outputs.message }}"
          echo "Tag: ${{ steps.cf_deploy.outputs.tag }}"
```

### Example 2: Only Upload (Manual / External Deploy)

Use this when you:

- Want to create a version with metadata.
- Plan to deploy that `version_id` from another workflow or system.

```yaml
name: Upload Worker Version Only

on:
  workflow_dispatch:

jobs:
  upload-version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm dlx wrangler@4 --version

      - name: Upload Worker Version with metadata (no deploy)
        id: cf_upload
        uses: mkcode/wrangler-version-deploy-action-with-metadata@v1
        with:
          api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          wrangler_command: "pnpm dlx wrangler@4"
          working_directory: "."
          config: "wrangler.toml"
          upload_args: "--env staging"
          only_upload: "true"
          message_template: "Staging candidate {{repo}}@{{short_sha}} on {{branch}} (run {{run_number}})"

      - name: Use uploaded version ID
        run: |
          echo "Uploaded version: ${{ steps.cf_upload.outputs.version_id }}"
```

### Example 3: Custom Templates and PR Comments

You can combine outputs with other Actions to post deployment info back to PRs:

```yaml
- name: Deploy with metadata
  id: cf_deploy
  uses: mkcode/wrangler-version-deploy-action-with-metadata
  with:
    api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    config: "wrangler.toml"
    upload_args: "--env preview"
    deploy_args: "--env preview"
    message_template: "[preview] {{repo}}@{{short_sha}} on {{branch}} by {{actor}}"
    tag_template: "preview-{{short_sha}}"

- name: Comment on PR with deployment info
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const url = "${{ steps.cf_deploy.outputs.deployment_url }}";
      const version = "${{ steps.cf_deploy.outputs.version_id }}";
      const msg = "${{ steps.cf_deploy.outputs.message }}";
      const tag = "${{ steps.cf_deploy.outputs.tag }}";
      github.rest.issues.createComment({
        ...context.repo,
        issue_number: context.issue.number,
        body: [
          "🚀 Preview deployment created:",
          url && `- URL: ${url}`,
          version && `- Version: ${version}`,
          msg && `- Message: ${msg}`,
          tag && `- Tag: ${tag}`,
        ].filter(Boolean).join("\n")
      });
```

### Example 4: Monorepo - Deploy Only When a Folder Changes

In a monorepo, you often want to:

- Only run builds/deploys when a specific app/package directory changes.
- Use a config file that lives within that directory.

This example:

- Triggers only when files under `apps/worker-app/` change.
- Uses the Wrangler config at `apps/worker-app/wrangler.toml`.
- Builds and deploys only that app.

```yaml
name: Deploy Worker App (Monorepo)

on:
  push:
    branches: [main]
    paths:
      - "apps/worker-app/**"

jobs:
  deploy-worker-app:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/worker-app

    steps:
      - uses: actions/checkout@v4

      # Install and build only this app
      # - run: pnpm install
      # - run: pnpm build

      - name: Upload + deploy worker-app via Versions API with metadata
        id: cf_deploy
        uses: mkcode/wrangler-version-deploy-action-with-metadata@v1
        with:
          api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          wrangler_command: "pnpm dlx wrangler@4"
          working_directory: "apps/worker-app"
          config: "wrangler.toml"
          upload_args: "--env production"
          deploy_args: "--env production"
          message_template: "worker-app: {{repo}}@{{short_sha}} on {{branch}} (run {{run_number}})"
