local typescript_lsp = require("typescript-lsp")

local fixture_root = vim.fn.tempname()

local function write(path, contents)
  vim.fn.mkdir(vim.fs.dirname(path), "p")
  vim.fn.writefile({ contents }, path)
end

local function project(name, package_path, version)
  local root = vim.fs.joinpath(fixture_root, name)
  local source =
    vim.fs.joinpath(root, "packages", "app", "src", "index.ts")
  write(source, "const answer: number = 42")
  if package_path then
    write(
      vim.fs.joinpath(root, unpack(package_path)),
      vim.json.encode({ version = version })
    )
  end
  return root, source
end

local ok, err = xpcall(function()
  local legacy_root, legacy_source = project(
    "legacy",
    { "node_modules", "typescript", "package.json" },
    "6.0.0"
  )
  local native_root, native_source = project(
    "native",
    { "node_modules", "typescript", "package.json" },
    "7.0.2"
  )
  local yarn_root, yarn_source = project(
    "yarn",
    { ".yarn", "sdks", "typescript", "package.json" },
    "6.2.0"
  )
  local pnpm_root, pnpm_source = project(
    "pnpm",
    { ".pnpm", "sdks", "typescript", "package.json" },
    "7.1.0-beta.1"
  )
  local pnpify_root, pnpify_source = project(
    "pnpify",
    { ".vscode", "pnpify", "typescript", "package.json" },
    "5.9.3"
  )
  local missing_root, missing_source = project("missing")

  assert(
    typescript_lsp.select({
      path = legacy_source,
      root = legacy_root,
      native_available = true,
    }) == "ts_ls",
    "a local pre-7 TypeScript must take precedence over a global native server"
  )
  assert(typescript_lsp.select({
    path = native_source,
    root = native_root,
    native_available = false,
  }) == "tsc", "TypeScript 7 must select the native server")
  assert(typescript_lsp.select({
    path = yarn_source,
    root = yarn_root,
    native_available = true,
  }) == "ts_ls", "Yarn SDK TypeScript must be detected")
  assert(typescript_lsp.select({
    path = pnpm_source,
    root = pnpm_root,
    native_available = false,
  }) == "tsc", "pnpm SDK TypeScript must be detected")
  assert(typescript_lsp.select({
    path = pnpify_source,
    root = pnpify_root,
    native_available = true,
  }) == "ts_ls", "PnPify TypeScript must be detected")
  assert(
    typescript_lsp.select({
      path = missing_source,
      root = missing_root,
      native_available = true,
    }) == "tsc",
    "a native executable must be preferred when no workspace TypeScript exists"
  )
  assert(
    typescript_lsp.select({
      path = missing_source,
      root = missing_root,
      native_available = false,
    }) == "ts_ls",
    "ts_ls must be the fallback when no native executable exists"
  )
  assert(typescript_lsp.select({
    override = "ts_ls",
    path = native_source,
    root = native_root,
    native_available = true,
  }) == "ts_ls", "the explicit legacy override must win")

  local selected, invalid_override = typescript_lsp.select({
    override = "invalid",
    path = native_source,
    root = native_root,
  })
  assert(
    selected == nil and invalid_override,
    "invalid overrides must fail closed"
  )

  local monorepo_root, monorepo_source = project(
    "monorepo",
    { "node_modules", "typescript", "package.json" },
    "7.0.0"
  )
  write(
    vim.fs.joinpath(
      monorepo_root,
      "packages",
      "app",
      "node_modules",
      "typescript",
      "package.json"
    ),
    [[{"version":"6.0.0"}]]
  )
  assert(
    typescript_lsp.select({
      path = monorepo_source,
      root = monorepo_root,
      native_available = true,
    }) == "ts_ls",
    "the nearest package-local TypeScript must win in a monorepo"
  )
end, debug.traceback)

vim.fn.delete(fixture_root, "rf")
assert(ok, err)
