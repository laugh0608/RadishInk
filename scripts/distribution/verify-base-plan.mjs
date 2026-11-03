import fs from "node:fs";
import { parseArgs } from "node:util";
import { collectInventory } from "./base-inventory.mjs";
import { validatePlan } from "./source-bundle.mjs";

try {
  const { values } = parseArgs({
    options: { server: { type: "string" }, web: { type: "string" } },
  });
  if (!values.server || !values.web)
    throw new Error("Both --server and --web are required");
  const plan = validatePlan(
    JSON.parse(
      fs.readFileSync(
        new URL(
          "../../LICENSES/distribution/base-image-plan.json",
          import.meta.url,
        ),
      ),
    ),
  );
  for (const component of ["server", "web"]) {
    const actual = collectInventory(component, values[component]);
    const expected = plan.inventories.find(
      (i) => i.component === component && i.platform === actual.platform,
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `Final image base source plan drift: ${component}/${actual.platform}`,
      );
  }
  console.log(
    "Final-image base source requirements match reviewed plan; source provision is a separate gate",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
