return function(_, opts)
  local wk = require("which-key")
  wk.setup(opts)
  -- Native neovim actions
  wk.register({
    ["<leader>"] = {
      ["r"] = {
        ":exec &rnu == 1 ? 'set nornu!' : 'set rnu!'<CR>",
        "Toggle rel num",
        silent = true,
        mode = { "n", "v" },
      },
      ["s"] = { ":sort<CR>", "Sort", mode = { "v" } },
    },
    ["ZZ"] = { ":qa<CR>", "Quit" },
  })
end
