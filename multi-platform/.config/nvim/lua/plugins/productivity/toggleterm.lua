return {
  -- Floating terminal
  {
    "akinsho/toggleterm.nvim",
    config = function()
      require("toggleterm").setup({
        open_mapping = "<C-Space>",
        insert_mappings = false,
        terminal_mappings = true,
        size = vim.o.columns * 0.4,
        direction = "vertical",
      })
    end,
  },
}
