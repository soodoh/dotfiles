return {
  {
    "NeogitOrg/neogit",
    dependencies = {
      "nvim-lua/plenary.nvim", -- required
      "sindrets/diffview.nvim", -- optional - Diff integration
      "nvim-telescope/telescope.nvim", -- optional
    },
    config = function()
      local neogit = require("neogit")
      neogit.setup({})
      require("which-key").add({
        {
          "<leader>gg",
          function()
            neogit.open()
          end,
          desc = "Open Neogit",
        },
      })
    end,
  },
}
