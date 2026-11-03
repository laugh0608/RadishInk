import fs from "node:fs";
import { parseArgs } from "node:util";
import {
  deploymentContext,
  Docker,
  preflight,
  applyDeployment,
} from "./release-deploy.mjs";

function read(filename, maximum) {
  if (!filename)
    throw new Error(
      "--release, --env-file, --project and --state-dir are required",
    );
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > maximum)
      throw new Error("Deployment input must be a bounded regular file");
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

const abort = new AbortController();
const cancel = () => abort.abort(new Error("Deployment interrupted"));
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      release: { type: "string" },
      "env-file": { type: "string" },
      project: { type: "string" },
      "state-dir": { type: "string" },
      upgrade: { type: "boolean", default: false },
      "no-pull": { type: "boolean", default: false },
      "ready-timeout": { type: "string", default: "90" },
    },
  });
  if (
    positionals.length !== 1 ||
    !["preflight", "apply"].includes(positionals[0])
  )
    throw new Error(
      "Usage: deploy <preflight|apply> --release <lock.json> --env-file <public.env> --project <name> --state-dir <existing-private-directory> [--upgrade] [--no-pull]",
    );
  let release;
  try {
    release = JSON.parse(read(values.release, 128 * 1024));
  } catch {
    throw new Error("Invalid release lock input");
  }
  const context = deploymentContext({
    release,
    configuration: read(values["env-file"], 16 * 1024),
    project: values.project ?? "",
    stateDir: values["state-dir"] ?? "",
    upgrade: values.upgrade,
    noPull: values["no-pull"],
    readyTimeout: Number(values["ready-timeout"]),
  });
  const docker = new Docker(context.env, abort.signal);
  const result =
    positionals[0] === "preflight"
      ? await preflight(context, docker)
      : await applyDeployment(context, docker, undefined, (stage) =>
          process.stderr.write(`deployment: ${stage}\n`),
        );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
}
