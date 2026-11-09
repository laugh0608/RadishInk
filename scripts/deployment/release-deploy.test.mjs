import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  deploymentContext,
  preflight,
  applyDeployment,
} from "./release-deploy.mjs";
import {
  releaseLock,
  publicConfiguration,
  verifyImage,
  SOURCE,
} from "./release-config.mjs";
import { parseYaml } from "../check-repo.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const lock = () => ({
  formatVersion: 1,
  tag: "v26.11.1-test",
  revision: "a".repeat(40),
  platform: "linux/arm64",
  images: {
    web: { digest: `sha256:${"1".repeat(64)}` },
    server: { digest: `sha256:${"2".repeat(64)}` },
  },
});
const configuration =
  "RADISHINK_ORIGIN=http://127.0.0.1:4294\nRADISHINK_ENV=development\nRADISHINK_PORT=4294\nRADISHINK_ACCOUNT_MODE=shared\nRADISHINK_PASSWORD_LOGIN=false\nRADISHINK_WORKSPACE_VOLUME=synthetic-workspace\nRADISHINK_BACKUP_VOLUME=synthetic-backups\n";
function fixture(t, options = {}) {
  const stateDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "radishink-deploy-test-")),
  );
  fs.chmodSync(stateDir, 0o700);
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const context = deploymentContext({
    release: lock(),
    configuration,
    project: "synthetic",
    stateDir,
    ...options,
  });
  return {
    context,
    record: () =>
      JSON.parse(fs.readFileSync(path.join(stateDir, "latest.json"), "utf8")),
  };
}

function engine(
  context,
  {
    schema = 3,
    fail = () => false,
    unknownPaths = [],
    serverHealth = "healthy",
  } = {},
) {
  const calls = [];
  let currentSchema = schema;
  const workspace = () => ({
    schema: currentSchema,
    deploymentId: "synthetic-deployment",
    workspaceEpoch: "synthetic-epoch",
    accountMode: "shared",
  });
  const docker = {
    async run(args, options = {}) {
      calls.push(args);
      if (fail(args)) throw new Error("Injected command failure");
      if (args[0] === "image")
        return [
          {
            Os: "linux",
            Architecture: "arm64",
            Descriptor: {
              digest:
                context.lock.images[
                  args[2] === context.lock.references.web ? "web" : "server"
                ].digest,
              mediaType: "application/vnd.oci.image.manifest.v1+json",
            },
            Config: {
              User: args[2] === context.lock.references.web ? "nginx" : "node",
              Labels: {
                "org.opencontainers.image.version": context.lock.tag,
                "org.opencontainers.image.revision": context.lock.revision,
                "org.opencontainers.image.source": SOURCE,
              },
            },
          },
        ];
      if (args[0] === "volume" && args[1] === "inspect")
        return [{ Name: args[2], Driver: "local", Options: null }];
      if (args.includes("config"))
        return {
          volumes: {
            workspace: {
              name: context.env.RADISHINK_WORKSPACE_VOLUME,
              external: true,
            },
          },
          services: {
            web: { image: context.lock.references.web },
            server: { image: context.lock.references.server },
          },
        };
      if (args[0] === "ps") return "";
      if (args[0] === "compose" && args.includes("ps")) return serverHealth;
      if (args.includes("inspect-workspace.cjs")) return workspace();
      if (args.includes("backup"))
        return { ...workspace(), files: 5, bytes: 100 };
      if (args.includes("restore"))
        return { ...workspace(), workspaceEpoch: "restored-epoch" };
      if (args.includes("upgrade-auth") || args.includes("upgrade-oidc"))
        currentSchema++;
      if (args.includes("check") && options.json) return { unknownPaths };
      if (args[0] === "create") return "synthetic-lock-container-id";
      return "";
    },
  };
  return { docker, calls };
}

test("fixed references require a canonical full tag and a digest for both components", () => {
  const good = releaseLock(lock());
  assert.match(
    good.references.server,
    /^ghcr\.io\/laugh0608\/radishink-server:v26\.11\.1-test@sha256:/,
  );
  for (const change of [
    (x) => {
      x.tag = "latest";
    },
    (x) => {
      delete x.images.server;
    },
    (x) => {
      x.images.web.digest = "sha256:short";
    },
    (x) => {
      x.revision = "abc";
    },
    (x) => {
      x.platform = "linux/unknown";
    },
    (x) => {
      x.images.web.repository = "unexpected";
    },
  ]) {
    const value = lock();
    change(value);
    assert.throws(() => releaseLock(value));
  }
});

test("public config rejects ambiguous input, secrets, shared login, malformed origins and overlapping volumes", () => {
  assert.equal(publicConfiguration(configuration).env.RADISHINK_PORT, "4294");
  for (const text of [
    configuration + "RADISHINK_PORT=4295\n",
    configuration + "RADISHINK_OIDC_CLIENT_SECRET=sensitive\n",
    configuration.replace("shared", "accounts"),
    configuration.replace("127.0.0.1:4294", "example.invalid"),
    configuration.replace("synthetic-backups", "synthetic-workspace"),
    configuration.replace(
      "RADISHINK_PASSWORD_LOGIN=false",
      "RADISHINK_PASSWORD_LOGIN=true",
    ),
  ])
    assert.throws(() => publicConfiguration(text));
});

test("OCI provenance mismatches fail independently of a valid digest", () => {
  const valid = {
    Os: "linux",
    Architecture: "arm64",
    Descriptor: {
      digest: lock().images.server.digest,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
    },
    Config: {
      User: "node",
      Labels: {
        "org.opencontainers.image.version": lock().tag,
        "org.opencontainers.image.revision": lock().revision,
        "org.opencontainers.image.source": SOURCE,
      },
    },
  };
  assert.doesNotThrow(() => verifyImage(valid, lock(), "server"));
  for (const field of [
    "org.opencontainers.image.version",
    "org.opencontainers.image.revision",
    "org.opencontainers.image.source",
  ]) {
    const labels = {
      "org.opencontainers.image.version": lock().tag,
      "org.opencontainers.image.revision": lock().revision,
      "org.opencontainers.image.source": SOURCE,
      [field]: "wrong",
    };
    assert.throws(
      () =>
        verifyImage(
          { ...valid, Config: { ...valid.Config, Labels: labels } },
          lock(),
          "server",
        ),
      /mismatch/,
    );
  }
  for (const mutate of [
    (x) => {
      x.Architecture = "amd64";
    },
    (x) => {
      x.Config.User = "root";
    },
    (x) => {
      x.Descriptor.mediaType = "application/vnd.oci.image.index.v1+json";
    },
    (x) => {
      x.Descriptor.digest = `sha256:${"9".repeat(64)}`;
    },
    (x) => {
      delete x.Descriptor;
    },
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.throws(() => verifyImage(value, lock(), "server"), /mismatch/);
  }
});

test("failed stop is reported without claiming the entry closed", async (t) => {
  const f = fixture(t);
  const e = engine(f.context, { fail: (args) => args.includes("stop") });
  await assert.rejects(
    applyDeployment(f.context, e.docker, async () => {}),
    /stopping-entry/,
  );
  assert.equal(f.record().entryStopped, false);
  assert.equal(f.record().stopFailed, true);
  assert.ok(!e.calls.some((args) => args.includes("backup")));
});

test("another operator's file lock and malformed previous records are preserved", async (t) => {
  const f = fixture(t);
  const e = engine(f.context);
  const lockFile = path.join(f.context.stateDir, ".deployment-lock");
  fs.writeFileSync(lockFile, "another operation");
  await assert.rejects(applyDeployment(f.context, e.docker), /EEXIST/);
  assert.equal(fs.readFileSync(lockFile, "utf8"), "another operation");
  assert.equal(e.calls.length, 0);
  fs.unlinkSync(lockFile);
  const previous = JSON.stringify({
    formatVersion: 1,
    project: f.context.project,
  });
  fs.writeFileSync(path.join(f.context.stateDir, "latest.json"), previous);
  await assert.rejects(
    applyDeployment(f.context, e.docker),
    /Invalid previous deployment record/,
  );
  assert.equal(
    fs.readFileSync(path.join(f.context.stateDir, "latest.json"), "utf8"),
    previous,
  );
});

test("pull Compose retains local service hardening and uses an explicit external workspace", () => {
  const local = parseYaml(
    fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8"),
  );
  const pulled = parseYaml(
    fs.readFileSync(path.join(root, "deploy/compose.release.yml"), "utf8"),
  );
  for (const component of ["server", "web"]) {
    const expected = structuredClone(local.services[component]);
    delete expected.build;
    const actual = structuredClone(pulled.services[component]);
    assert.equal(actual.pull_policy, "never");
    assert.ok(actual.image);
    delete actual.image;
    delete actual.pull_policy;
    assert.deepEqual(actual, expected);
  }
  assert.equal(pulled.volumes.workspace.external, true);
});

test("preflight neither mutates volumes nor creates state or stops services", async (t) => {
  const f = fixture(t);
  const e = engine(f.context);
  await preflight(f.context, e.docker);
  assert.deepEqual(fs.readdirSync(f.context.stateDir), []);
  assert.ok(
    e.calls.every(
      (args) =>
        !args.includes("stop") &&
        !args.includes("pull") &&
        !args.includes("create"),
    ),
  );
  const inspection = e.calls.find((args) =>
    args.includes("inspect-workspace.cjs"),
  );
  assert.ok(
    inspection.includes(
      "type=volume,source=synthetic-workspace,target=/data,readonly",
    ),
  );
  assert.ok(
    inspection.includes(
      "type=volume,source=synthetic-backups,target=/backups,readonly",
    ),
  );
});

test("normal apply independently restores the backup, checks storage and then opens the entry", async (t) => {
  const f = fixture(t);
  const e = engine(f.context);
  let entryChecked = false;
  const result = await applyDeployment(f.context, e.docker, async () => {
    entryChecked = true;
  });
  assert.equal(result.status, "succeeded");
  assert.ok(entryChecked);
  const stages = result.history.map((item) => item.stage);
  assert.ok(
    stages.indexOf("verifying-backup") < stages.indexOf("checking-storage"),
  );
  assert.ok(
    stages.indexOf("checking-storage") < stages.indexOf("starting-server"),
  );
  assert.ok(
    stages.indexOf("starting-server") < stages.indexOf("restoring-entry"),
  );
  assert.ok(e.calls.some((args) => args.includes("restore")));
  assert.ok(
    !e.calls.some(
      (args) => args.includes("upgrade-auth") || args.includes("upgrade-oidc"),
    ),
  );
  assert.ok(!fs.existsSync(path.join(f.context.stateDir, ".deployment-lock")));
});

for (const [name, predicate, stage, changed] of [
  ["missing image", (args) => args[0] === "pull", "preparing-images", false],
  ["backup failure", (args) => args.includes("backup"), "backing-up", false],
  [
    "independent restore failure",
    (args) => args.includes("restore"),
    "verifying-backup",
    false,
  ],
  [
    "storage failure",
    (args) => args.includes("check"),
    "checking-storage",
    false,
  ],
  [
    "readiness timeout",
    (args) => args.includes("up") && args.at(-1) === "server",
    "starting-server",
    true,
  ],
]) {
  test(`${name} preserves the failure stage and never reports ready`, async (t) => {
    const f = fixture(t);
    const e = engine(f.context, { fail: predicate });
    await assert.rejects(
      applyDeployment(f.context, e.docker, async () => {}),
      new RegExp(stage),
    );
    const result = f.record();
    assert.equal(result.status, "failed");
    assert.equal(result.failedStage, stage);
    assert.equal(result.dataMayHaveChanged, changed);
    assert.ok(!result.history.some((item) => item.stage === "ready"));
    if (stage === "preparing-images")
      assert.ok(!e.calls.some((args) => args.includes("stop")));
    else assert.equal(result.entryStopped, true);
  });
}

test("a successful Compose wait with a starting server keeps the Web entry closed", async (t) => {
  const f = fixture(t);
  const e = engine(f.context, { serverHealth: "starting" });
  await assert.rejects(applyDeployment(f.context, e.docker), /starting-server/);
  const result = f.record();
  assert.equal(result.failedStage, "starting-server");
  assert.equal(result.entryStopped, true);
  assert.ok(
    !e.calls.some((args) => args.includes("up") && args.at(-1) === "web"),
  );
});

test("upgrade is explicit and interruption keeps the entry stopped and blocks retry without overwriting evidence", async (t) => {
  const f = fixture(t);
  const e = engine(f.context, { schema: 1 });
  await assert.rejects(preflight(f.context, e.docker), /explicit --upgrade/);
  f.context.upgrade = true;
  const failed = engine(f.context, {
    schema: 1,
    fail: (args) => args.includes("upgrade-auth"),
  });
  await assert.rejects(
    applyDeployment(f.context, failed.docker, async () => {}),
    /upgrading-schema/,
  );
  const before = fs.readFileSync(path.join(f.context.stateDir, "latest.json"));
  await assert.rejects(
    applyDeployment(f.context, engine(f.context).docker, async () => {}),
    /Previous deployment may have changed data/,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(f.context.stateDir, "latest.json")),
    before,
  );
  assert.equal(f.record().entryStopped, true);
});

test("legacy shared schema is backed up and upgraded once per actual increment", async (t) => {
  const f = fixture(t, { upgrade: true });
  const e = engine(f.context, { schema: 1 });
  const result = await applyDeployment(f.context, e.docker, async () => {});
  assert.equal(result.after.schema, 3);
  assert.equal(
    e.calls.filter((args) => args.includes("upgrade-auth")).length,
    1,
  );
  assert.equal(
    e.calls.filter((args) => args.includes("upgrade-oidc")).length,
    1,
  );
});

test("unknown storage paths and a mismatched public entry keep the deployment closed", async (t) => {
  const f = fixture(t);
  const e = engine(f.context, { unknownPaths: ["unknown"] });
  await assert.rejects(
    applyDeployment(f.context, e.docker, async () => {}),
    /checking-storage/,
  );
  const second = fixture(t);
  const ready = engine(second.context);
  await assert.rejects(
    applyDeployment(second.context, ready.docker, async () => {
      throw new Error("entry mismatch");
    }),
    /verifying-entry/,
  );
  assert.equal(second.record().entryStopped, true);
});
