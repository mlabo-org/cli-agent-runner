import path from "node:path";
import { fileURLToPath } from "node:url";

import { TEXT_GATE_ENV } from "../../lib/text-gate.mjs";

// The runner refuses to launch a child without text-gate.  Tests use the
// bundled stand-in unless the environment already names a real binary.
export const TEXT_GATE_STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "text-gate-stub.mjs");
if (!process.env[TEXT_GATE_ENV]) process.env[TEXT_GATE_ENV] = TEXT_GATE_STUB;
