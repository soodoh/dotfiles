return {
  -- Automatic folds via LSP or Treesitter
  {
    "kevinhwang91/nvim-ufo",
    dependencies = {
      "kevinhwang91/promise-async",
    },
    config = function()
      local ufo = require("ufo")
      ufo.setup()
      vim.o.fillchars =
      [[eob: ,fold: ,foldopen:,foldsep: ,foldclose:]]
      vim.o.foldcolumn = "1"
      vim.o.foldlevel = 99
      vim.o.foldlevelstart = 99
      vim.o.foldenable = true

      require("which-key").register({
        zR = {
          ufo.openAllFolds,
          "Open all folds",
        },
        zM = {
          ufo.closeAllFolds,
          "Close all folds",
        },
      })
    end,
  },
}
