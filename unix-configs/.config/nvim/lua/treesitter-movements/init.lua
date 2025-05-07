local function getCurrentNode()
  local bufnr = vim.api.nvim_get_current_buf()
  local cursor = vim.api.nvim_win_get_cursor(0)
  local row, col = cursor[1] - 1, cursor[2]
  local parser = vim.treesitter.get_parser(bufnr)
  local tree = parser:parse()[1]
  local root = tree:root()
  local current_node = root:named_descendant_for_range(row, col)
  return current_node
end

function MoveToNextNode()
  local current_node = getCurrentNode()
  local next_node = current_node
  while next_node do
    local node = next_node:next_named_sibling()
    if node then
      next_node = node
      break
    else
      next_node = next_node:parent()
    end
  end
  if next_node then
    local start_row, start_col = next_node:start()
    vim.api.nvim_win_set_cursor(0, { start_row + 1, start_col })
  end
end

function MoveToNextSibling()
  local current_node = getCurrentNode()
  local next_sibling = current_node:next_named_sibling()
  if next_sibling then
    local start_row, start_col = next_sibling:start()
    vim.api.nvim_win_set_cursor(0, { start_row + 1, start_col })
  end
end

function MoveToPreviousNode()
  local current_node = getCurrentNode()
  local previous_node = current_node:prev_named_sibling()
  if not previous_node then
    previous_node = current_node:parent()
  end
  if previous_node then
    local start_row, start_col = previous_node:start()
    vim.api.nvim_win_set_cursor(0, { start_row + 1, start_col })
  end
end

function MoveToPreviousSibling()
  local current_node = getCurrentNode()
  local previous_sibling = current_node:prev_named_sibling()
  if previous_sibling then
    local start_row, start_col = previous_sibling:start()
    vim.api.nvim_win_set_cursor(0, { start_row + 1, start_col })
  end
end

function MoveToParent()
  local current_node = getCurrentNode()
  local parent_node = current_node:parent()
  if parent_node then
    local start_row, start_col = parent_node:start()
    vim.api.nvim_win_set_cursor(0, { start_row + 1, start_col })
  end
end

function MoveToFirstSibling()
  local current_node = getCurrentNode()
  local first_sibling = current_node:parent():first_child()
  if first_sibling then
    local start_row, start_col = first_sibling:start()
    vim.api.nvim_win_set_cursor(0, { start_row + 1, start_col })
  end
end

function MoveToLastSibling()
  local current_node = getCurrentNode()
  local last_sibling = current_node:parent():last_child()
  if last_sibling then
    local start_row, start_col = last_sibling:start()
    vim.api.nvim_win_set_cursor(0, { start_row + 1, start_col })
  end
end

vim.keymap.set(
  "n",
  ",j",
  MoveToNextNode,
  { silent = true, desc = "Go to next AST node" }
)
vim.keymap.set(
  "n",
  ",k",
  MoveToPreviousNode,
  { silent = true, desc = "Go to prev AST node" }
)
vim.keymap.set(
  "n",
  ",l",
  MoveToNextSibling,
  { silent = true, desc = "Go to next sibling AST node" }
)
vim.keymap.set(
  "n",
  ",h",
  MoveToPreviousSibling,
  { silent = true, desc = "Go to previous sibling AST node" }
)
vim.keymap.set(
  "n",
  ",J",
  MoveToLastSibling,
  { silent = true, desc = "Go to last sibling AST node" }
)
vim.keymap.set(
  "n",
  ",K",
  MoveToPreviousNode,
  { silent = true, desc = "Go to first sibling AST node" }
)
vim.keymap.set(
  "n",
  ",P",
  MoveToParent,
  { silent = true, desc = "Go to parent AST node" }
)
