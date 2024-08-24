return {
  -- Git status in column
  {
    "lewis6991/gitsigns.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      require("gitsigns").setup({
        signs = {
          add = { text = "│" },
          change = { text = "│" },
          delete = { text = "_" },
          topdelete = { text = "‾" },
          changedelete = { text = "~" },
          untracked = { text = "┆" },
        },
        signcolumn = true,
        current_line_blame = true, -- Toggle with `:Gitsigns toggle_current_line_blame`
        current_line_blame_opts = {
          virt_text = true,
          virt_text_pos = "eol", -- 'eol' | 'overlay' | 'right_align'
          delay = 100,
          ignore_whitespace = false,
        },
        current_line_blame_formatter = '<author>, <author_time:%R> - <summary>',
        on_attach = function(bufnr)
          local gs = package.loaded.gitsigns
          require("which-key").add({
            {
              ",h",
              function()
                if vim.wo.diff then
                  return ",h"
                end
                vim.schedule(function()
                  gs.next_hunk()
                end)
                return "<Ignore>"
              end,
              desc = "Go to next hunk (Gitsigns)",
            },
            {
              ",,h",
              function()
                if vim.wo.diff then
                  return ",,h"
                end
                vim.schedule(function()
                  gs.prev_hunk()
                end)
                return "<Ignore>"
              end,
              desc = "Go to previous hunk (Gitsigns)",
            },
            { "<leader>h", group = "Gitsigns" },
            {
              "<leader>hs",
              gs.stage_hunk,
              desc = "Stage hunk (Gitsigns)",
            },
            {
              "<leader>hS",
              gs.stage_buffer,
              desc = "Stage buffer (Gitsigns)",
            },
            {
              "<leader>hr",
              gs.reset_hunk,
              desc = "Reset hunk (Gitsigns)",
            },
            {
              "<leader>hR",
              gs.reset_buffer,
              desc = "Reset buffer (Gitsigns)",
            },
            {
              "<leader>hu",
              gs.undo_stage_hunk,
              desc = "Unstage hunk (Gitsigns)",
            },
            {
              "<leader>hp",
              gs.prewview_hunk,
              desc = "Preview hunk (Gitsigns)",
            },
            {
              "<leader>hb",
              function()
                gs.blame_line({ full = true })
              end,
              desc = "View blame (Gitsigns)",
            },
          })
        end,
      })
    end,
  },
}
