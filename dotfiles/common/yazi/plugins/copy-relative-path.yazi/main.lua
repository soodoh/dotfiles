local snapshot = ya.sync(function(state)
  local urls = {}
  for _, file in pairs(cx.active.selected) do
    urls[#urls + 1] = file.url
  end
  if #urls == 0 and cx.active.current.hovered then
    urls[1] = cx.active.current.hovered.url
  end
  -- ya.sync transfers Url ownership; never transfer the retained launch URL.
  return cx.active.current.cwd, Url(state.launch_dir), urls
end)

local function local_url(url)
  if url.spec.is_regular or url.spec.is_search then
    return Url(tostring(url.path))
  end
end

local function relative_path(url, base)
  local parts = {}
  while not url:starts_with(base) do
    base = base.parent
    parts[#parts + 1] = ".."
  end
  local tail = tostring(url:strip_prefix(base))
  if tail ~= "" then
    parts[#parts + 1] = tail
  end
  return #parts == 0 and "." or table.concat(parts, "/")
end

return {
  setup = function(self)
    -- Capture before navigation: Yazi updates its process cwd as you browse.
    self.launch_dir = assert(fs.cwd())
  end,

  entry = function()
    local cwd, launch_dir, urls = snapshot()
    if #urls == 0 then
      return
    end
    cwd = local_url(cwd)
    for i, url in ipairs(urls) do
      urls[i] = local_url(url)
      if not urls[i] then
        return ya.notify({
          title = "Copy relative paths",
          content = "Only local files are supported",
          level = "warn",
          timeout = 3,
        })
      end
    end
    if not cwd then
      return
    end

    local base = launch_dir
    local output =
      Command("git")
        :arg({ "-C", tostring(cwd), "rev-parse", "--show-toplevel" })
        :output()
    if output and output.status.success then
      base = Url((output.stdout:gsub("\n$", "")))
    end

    local paths = {}
    for _, url in ipairs(urls) do
      paths[#paths + 1] = relative_path(url, base)
    end
    table.sort(paths)
    ya.clipboard(table.concat(paths, "\n"))
  end,
}
