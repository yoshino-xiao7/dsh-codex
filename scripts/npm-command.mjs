import { existsSync } from "node:fs"
import path from "node:path"

/** Resolve npm through its JS entry when possible, avoiding platform command shims. */
export function resolveNpmCommand({
  environment = process.env,
  nodeExecutable = process.execPath,
  platform = process.platform,
  fileExists = existsSync,
} = {}) {
  const configured = environment.npm_execpath
  if (configured !== undefined && /npm-cli\.[cm]?js$/iu.test(configured) && fileExists(configured)) {
    return Object.freeze({ executable: nodeExecutable, prefixArgs: [configured], shell: false })
  }

  const executableDirectory = path.dirname(nodeExecutable)
  const bundled = platform === "win32"
    ? path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js")
    : path.resolve(executableDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  if (fileExists(bundled)) {
    return Object.freeze({ executable: nodeExecutable, prefixArgs: [bundled], shell: false })
  }

  return Object.freeze({
    executable: platform === "win32" ? "npm.cmd" : "npm",
    prefixArgs: [],
    shell: platform === "win32",
  })
}
