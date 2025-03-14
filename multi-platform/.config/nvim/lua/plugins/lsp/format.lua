return {
  "stevearc/conform.nvim",
  config = function()
    require("conform").setup({
      formatters_by_ft = {
        lua = { "stylua", lsp_format = "first" },
        python = { "black", lsp_format = "first" },
        rust = { "rstfmt", lsp_format = "fallback" },
        javascript = { "prettier", lsp_format = "first" },
        typescript = { "prettier", lsp_format = "first" },
        javascriptreact = { "prettier", lsp_format = "first" },
        typescriptreact = { "prettier", lsp_format = "first" },
        svelte = { "prettier", lsp_format = "first" },
        css = { "prettier", lsp_format = "first" },
        html = { "prettier", lsp_format = "first" },
        json = { "prettier", lsp_format = "first" },
        yaml = { "prettier", lsp_format = "first" },
        markdown = { "prettier", lsp_format = "first" },
        graphql = { "prettier", lsp_format = "first" },
      },
      -- Set this to change the default values when calling conform.format()
      -- This will also affect the default values for format_on_save/format_after_save
      default_format_opts = {
        lsp_format = "fallback",
      },
      -- If this is set, Conform will run the formatter on save.
      -- It will pass the table to conform.format().
      -- This can also be a function that returns the table.
      format_on_save = {
        -- I recommend these options. See :help conform.format for details.
        lsp_format = "fallback",
        timeout_ms = 500,
      },
      -- If this is set, Conform will run the formatter asynchronously after save.
      -- It will pass the table to conform.format().
      -- This can also be a function that returns the table.
      -- format_after_save = {
      --   lsp_format = "fallback",
      -- },
      -- Set the log level. Use `:ConformInfo` to see the location of the log file.
      log_level = vim.log.levels.ERROR,
      -- Conform will notify you when a formatter errors
      notify_on_error = true,
      -- Conform will notify you when no formatters are available for the buffer
      notify_no_formatters = true,
    })

    vim.api.nvim_create_user_command("Format", function(args)
      local range = nil
      if args.count ~= -1 then
        local end_line = vim.api.nvim_buf_get_lines(
          0,
          args.line2 - 1,
          args.line2,
          true
        )[1]
        range = {
          start = { args.line1, 0 },
          ["end"] = { args.line2, end_line:len() },
        }
      end
      require("conform").format({
        async = true,
        lsp_format = "fallback",
        range = range,
      })
    end, { range = true })

    require("which-key").add({
      {
        "<leader>sf",
        ":Format<CR>",
        desc = "Format buffer (LSP)",
      },
    })
  end,
}
