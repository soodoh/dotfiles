return {
  {
    "folke/snacks.nvim",
    priority = 1000,
    lazy = false,
    keys = {
      {
        "<leader>dd",
        function()
          Snacks.bufdelete()
        end,
        desc = "Close buffer (keep window open)",
      },
      {
        "<leader>dw",
        ":bd<CR>",
        desc = "Close buffer & window",
      },
    },
    opts = {
      bigfile = {
        enabled = true,
        size = 1.5 * 1024 * 1024,
      },
      statuscolumn = {
        enabled = true,
        left = { "mark", "sign" }, -- priority of signs on the left (high to low)
        right = { "fold", "git" }, -- priority of signs on the right (high to low)
        folds = {
          open = true, -- show open fold icons
          git_hl = false, -- use Git Signs hl for fold icons
        },
        git = {
          -- patterns to match Git signs
          patterns = { "GitSign", "MiniDiffSign" },
        },
        refresh = 50, -- refresh at most every 50ms
      },
    },
  },
}
