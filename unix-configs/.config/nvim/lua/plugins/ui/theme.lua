return {
  {
    "erl-koenig/theme-hub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      -- Optional: Telescope integration
      "nvim-telescope/telescope-ui-select.nvim",
      -- Optional: for themes that use lush (will be notified if a theme requires it)
      "rktjmp/lush.nvim",
    },
    config = function()
      require("theme-hub").setup({
        auto_install_on_select = true,
        apply_after_install = true,
        persistent = true,
      })
      require("telescope").load_extension("ui-select")
      require("which-key").add({
        { "<leader>t", group = "Themes" },
        {
          "<leader>th",
          ":ThemeHub<CR>",
          desc = "Switch/Preview themes",
        },
        {
          "<leader>tt",
          function()
            require("telescope.builtin").colorscheme({
              enable_preview = true,
              ignore_builtins = true,
            })
          end,
          desc = "Switch/Preview themes",
        },
      })

      -- Set default colorscheme, so persisted theme doesnt flash on load
      vim.cmd("colorscheme tokyodark")
    end,
  },
}
