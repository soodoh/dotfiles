local M = {}

local package_paths = {
  { "node_modules", "typescript", "package.json" },
  { ".yarn", "sdks", "typescript", "package.json" },
  { ".pnpm", "sdks", "typescript", "package.json" },
  { ".vscode", "pnpify", "typescript", "package.json" },
}

local function read_major(package_json)
  local ok, lines = pcall(vim.fn.readfile, package_json)
  if not ok then
    return nil, "could not read " .. package_json
  end

  local decoded_ok, package =
    pcall(vim.json.decode, table.concat(lines, "\n"))
  local version = decoded_ok and package and package.version
  local parsed = type(version) == "string" and vim.version.parse(version)
    or nil
  if not parsed then
    return nil,
      "could not parse the TypeScript version in " .. package_json
  end

  return parsed.major
end

local function start_directory(path)
  local stat = vim.uv.fs_stat(path)
  if stat and stat.type == "directory" then
    return vim.fs.normalize(path)
  end
  return vim.fs.dirname(vim.fs.normalize(path))
end

function M.workspace_major(path, root)
  local directory = start_directory(path)
  root = vim.fs.normalize(root)

  while directory do
    for _, parts in ipairs(package_paths) do
      local package_json = vim.fs.joinpath(directory, unpack(parts))
      if vim.uv.fs_stat(package_json) then
        local major, err = read_major(package_json)
        return major, err, package_json
      end
    end

    if directory == root then
      break
    end

    local parent = vim.fs.dirname(directory)
    if parent == directory or #parent < #root then
      break
    end
    directory = parent
  end

  return nil, nil, nil
end

local function supports_native(command)
  if vim.fn.executable(command) ~= 1 then
    return false
  end

  local result = vim
    .system({ command, "--version" }, { text = true })
    :wait()
  local version = vim.version.parse(result.stdout or "")
  return result.code == 0 and version ~= nil and version.major >= 7
end

function M.has_native_server(root)
  for _, binary in ipairs({ "tsc", "tsgo" }) do
    if
      supports_native(
        vim.fs.joinpath(root, "node_modules", ".bin", binary)
      )
    then
      return true
    end
    if supports_native(binary) then
      return true
    end
  end

  return false
end

function M.select(opts)
  local override = opts.override
  if override ~= nil and override ~= "" then
    if override ~= "tsc" and override ~= "ts_ls" then
      return nil, "NVIM_TYPESCRIPT_LSP must be either 'tsc' or 'ts_ls'"
    end
    return override
  end

  local major, err = M.workspace_major(opts.path, opts.root)
  if err then
    return nil, err
  end
  if major then
    return major >= 7 and "tsc" or "ts_ls"
  end

  local native_available = opts.native_available
  if native_available == nil then
    native_available = M.has_native_server(opts.root)
  end
  return native_available and "tsc" or "ts_ls"
end

local notified = {}

function M.filter_root(server, root_dir, project_root_dir)
  return function(bufnr, on_dir)
    project_root_dir(bufnr, function(project_root)
      local selected, err = M.select({
        override = vim.env.NVIM_TYPESCRIPT_LSP,
        path = vim.api.nvim_buf_get_name(bufnr),
        root = project_root,
      })

      if err then
        if not notified[err] then
          notified[err] = true
          vim.notify("TypeScript LSP: " .. err, vim.log.levels.ERROR)
        end
        return
      end

      if selected ~= server then
        return
      end

      if root_dir == project_root_dir then
        on_dir(project_root)
      else
        root_dir(bufnr, on_dir)
      end
    end)
  end
end

return M
