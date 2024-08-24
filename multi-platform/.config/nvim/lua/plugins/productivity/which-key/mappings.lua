return function(_, opts)
  local wk = require("which-key")
  wk.setup(opts)
  -- Native neovim actions
  wk.add({
    {
      "<leader>r",
      ":exec &rnu == 1 ? 'set nornu!' : 'set rnu!'<CR>",
      desc = "Toggle rel num",
      silent = true,
      mode = { "n", "v" },
    },
    {
      "<leader>S",
      ":sort<CR>",
      desc = "Sort",
      mode = { "v" },
    },
    {
      "ZZ",
      ":qa<CR>",
      desc = "Quit",
    },
  })
end
